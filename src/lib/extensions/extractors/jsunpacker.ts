// Unpacker for Dean Edwards' P.A.C.K.E.R., the obfuscator nearly every embed host ships its player
// config in: `eval(function(p,a,c,k,e,d){…}('<payload>',<base>,<count>,'<dict>'.split('|'),0,{}))`.
// Without this, a scraper looking for `sources:[{file:…}]` finds nothing — the URL only exists
// after the dictionary substitution.
//
// Decoded arithmetically rather than by running the script: the packed payload is attacker-
// controlled, and `eval`ing it inside the extension Worker would hand a hostile host arbitrary
// code execution.

/** Matches the packer's prelude. Some hosts rename the last parameter, hence the loose tail. */
const PACKED_RE = /eval\(function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[\w$]+\s*\)/

/** True when the source contains at least one packed block. */
export const isPacked = (source: string): boolean => PACKED_RE.test(source)

/** The packer's symbol encoding: a base-`base` number rendered with 0-9, a-z, then A-Z. */
function encodeSymbol(n: number, base: number): string {
  const digit = (c: number) => (c > 35 ? String.fromCharCode(c + 29) : c.toString(36))
  return (n < base ? '' : encodeSymbol(Math.floor(n / base), base)) + digit(n % base)
}

/** Undo JS string-literal escaping in ONE left-to-right pass. Chained `.replace` calls are wrong
 *  here: each re-processes the previous one's output, so a literal space or backslash in the
 *  payload gets mangled — and packed payloads contain both constantly. */
function unescapeJs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_m, esc: string) => {
    if (esc[0] === 'u' || esc[0] === 'x') return String.fromCharCode(parseInt(esc.slice(1), 16))
    if (esc === 'n') return '\n'
    if (esc === 't') return '\t'
    if (esc === 'r') return '\r'
    if (esc === 'b') return '\b'
    if (esc === 'f') return '\f'
    return esc // \\ \' \" and anything else stand for the character itself
  })
}

// Matches a COMPLETE packed call: prelude, decoder body, then the four arguments. Anchoring on the
// full argument list matters — the decoder body itself contains `))` and `}(`, so scanning for a
// closing token instead truncates the block long before the arguments and decodes nothing.
// The quoted strings skip over `\'` pairs rather than stopping at the first quote they see.
const PACKED_CALL_RE = new RegExp(
  String.raw`eval\(function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[\w$]+\s*\)\s*\{[\s\S]*?\}\s*\(` +
  String.raw`\s*'((?:[^'\\]|\\[\s\S])*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,` +
  String.raw`\s*'((?:[^'\\]|\\[\s\S])*)'\s*\.\s*split\s*\(\s*'\|'\s*\)` +
  String.raw`(?:\s*,\s*\d+\s*)?(?:\s*,\s*\{\s*\}\s*)?\s*\)\s*\)`,
  'g',
)

/** Decode the four captured packer arguments back to the original source. */
function decodeArgs(rawPayload: string, rawBase: string, rawCount: string, rawDict: string): string | null {
  const base = Number(rawBase)
  const count = Number(rawCount)
  if (!Number.isFinite(base) || !Number.isFinite(count) || base < 2) return null
  const payload = unescapeJs(rawPayload)
  const dict = unescapeJs(rawDict).split('|')
  let out = payload
  // Highest symbol first, exactly as the packer's own loop runs: substituting `a` before `aa`
  // would corrupt the longer symbols.
  for (let i = count - 1; i >= 0; i--) {
    const word = dict[i]
    if (!word) continue // an empty dictionary slot means "leave the symbol as-is"
    out = out.replace(new RegExp(`\\b${encodeSymbol(i, base)}\\b`, 'g'), word)
  }
  return out
}

/**
 * Unpack every packed block in `source` and return the decoded source. A block that fails to parse
 * is left untouched, and the result is re-scanned so nested packing (a packed payload that itself
 * contains a packed block — common on hosts that stack two layers) is fully resolved.
 */
export function unpack(source: string, depth = 0): string {
  if (depth > 4 || !isPacked(source)) return source
  let progressed = false
  const out = source.replace(PACKED_CALL_RE, (whole, payload: string, base: string, count: string, dict: string) => {
    const decoded = decodeArgs(payload, base, count, dict)
    if (decoded == null) return whole // unparseable block: leave it exactly as it was
    progressed = true
    return decoded
  })
  return progressed ? unpack(out, depth + 1) : out
}
