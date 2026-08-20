// Tiny and dependency-free because low-level HTTP/resolve modules import it. Production builds keep
// verbose Console output off until the user explicitly enables Developer logging in Settings.
let enabled = import.meta.env.DEV

export const developerConsoleEnabled = () => enabled
export const setDeveloperConsoleEnabled = (value: boolean) => { enabled = import.meta.env.DEV || value }
