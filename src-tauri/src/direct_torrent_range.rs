#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ByteRange {
    pub(crate) start: u64,
    /// Exclusive end offset.
    pub(crate) end: u64,
}

/// Parse one RFC 9110 byte range. mpv normally probes media with a bounded range such as
/// `bytes=0-65535`; rqbit 8.1.1 only understands the open-ended `bytes=N-` form and silently
/// turns every bounded probe into a 200 response streaming from byte zero.
pub(crate) fn parse_byte_range(value: Option<&str>, length: u64) -> Result<Option<ByteRange>, ()> {
    let Some(value) = value else {
        return Ok(None);
    };
    let spec = value.trim().strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') {
        // Multipart byte-range responses are unnecessary for mpv and deliberately unsupported.
        return Err(());
    }
    let (start, end) = spec.split_once('-').ok_or(())?;
    if length == 0 {
        return Err(());
    }

    if start.is_empty() {
        let suffix_length = end.parse::<u64>().map_err(|_| ())?;
        if suffix_length == 0 {
            return Err(());
        }
        let start = length.saturating_sub(suffix_length);
        return Ok(Some(ByteRange { start, end: length }));
    }

    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= length {
        return Err(());
    }
    let end = if end.is_empty() {
        length
    } else {
        // The wire format is inclusive. A requested end beyond EOF is valid and is clipped.
        end.parse::<u64>()
            .map_err(|_| ())?
            .saturating_add(1)
            .min(length)
    };
    if end <= start {
        return Err(());
    }
    Ok(Some(ByteRange { start, end }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bounded_range_without_expanding_it_to_the_whole_file() {
        assert_eq!(
            parse_byte_range(Some("bytes=100-199"), 1_000),
            Ok(Some(ByteRange {
                start: 100,
                end: 200
            }))
        );
    }

    #[test]
    fn parses_open_ended_and_suffix_ranges() {
        assert_eq!(
            parse_byte_range(Some("bytes=900-"), 1_000),
            Ok(Some(ByteRange {
                start: 900,
                end: 1_000
            }))
        );
        assert_eq!(
            parse_byte_range(Some("bytes=-100"), 1_000),
            Ok(Some(ByteRange {
                start: 900,
                end: 1_000
            }))
        );
    }

    #[test]
    fn clips_end_to_eof_and_rejects_unsatisfiable_ranges() {
        assert_eq!(
            parse_byte_range(Some("bytes=950-2000"), 1_000),
            Ok(Some(ByteRange {
                start: 950,
                end: 1_000
            }))
        );
        assert_eq!(parse_byte_range(Some("bytes=1000-"), 1_000), Err(()));
        assert_eq!(parse_byte_range(Some("bytes=10-9"), 1_000), Err(()));
        assert_eq!(parse_byte_range(Some("bytes=0-1,4-5"), 1_000), Err(()));
    }

    #[test]
    fn a_missing_range_requests_the_complete_file() {
        assert_eq!(parse_byte_range(None, 1_000), Ok(None));
    }
}
