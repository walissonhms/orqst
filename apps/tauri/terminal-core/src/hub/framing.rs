//! Port of `readMcpLines` (`mcp-socket.ts`): bounded newline-delimited JSON. A stream chunk
//! plus pending bytes over 128 KiB, a record over 64 KiB, an unterminated tail over 64 KiB,
//! invalid UTF-8 or invalid JSON all fail the connection. Nothing is logged.
use serde_json::Value;

pub const CHUNK_LIMIT: usize = 131_072;
pub const LINE_LIMIT: usize = 65_536;

/// The stream failed; the connection is destroyed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FramingFailed;

#[derive(Default)]
pub struct LineReader {
    pending: Vec<u8>,
    failed: bool,
}

impl LineReader {
    /// Feeds one read chunk. Returns the complete records, or `Err` once the stream failed
    /// (records before the failing one are still returned in order by `Ok` calls only).
    pub fn feed(
        &mut self,
        chunk: &[u8],
        mut line: impl FnMut(Value) -> bool,
    ) -> Result<(), FramingFailed> {
        if self.failed {
            return Err(FramingFailed);
        }
        if chunk.len() + self.pending.len() > CHUNK_LIMIT {
            return self.fail();
        }
        self.pending.extend_from_slice(chunk);
        while let Some(end) = self.pending.iter().position(|&b| b == b'\n') {
            let record: Vec<u8> = self.pending.drain(..=end).take(end).collect();
            if record.len() > LINE_LIMIT {
                return self.fail();
            }
            let Some(value) = decode(&record) else {
                return self.fail();
            };
            // `false` means the consumer stopped the stream (socket destroyed).
            if !line(value) {
                self.failed = true;
                return Ok(());
            }
        }
        if self.pending.len() > LINE_LIMIT {
            return self.fail();
        }
        Ok(())
    }

    /// End of stream: a partial record is a failure.
    pub fn end(&mut self) -> Result<(), FramingFailed> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            self.fail()
        }
    }

    fn fail(&mut self) -> Result<(), FramingFailed> {
        self.failed = true;
        self.pending.clear();
        Err(FramingFailed)
    }
}

/// `JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))`; the decoder drops a
/// leading byte order mark.
pub fn decode(bytes: &[u8]) -> Option<Value> {
    let text = std::str::from_utf8(bytes).ok()?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    serde_json::from_str(text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(reader: &mut LineReader, chunk: &[u8]) -> Result<Vec<Value>, FramingFailed> {
        let mut out = Vec::new();
        reader.feed(chunk, |v| {
            out.push(v);
            true
        })?;
        Ok(out)
    }

    #[test]
    fn frames_split_records() {
        let mut r = LineReader::default();
        assert_eq!(collect(&mut r, b"{\"a\":1}\n{\"b\"").unwrap().len(), 1);
        assert_eq!(
            collect(&mut r, b":2}\n").unwrap(),
            vec![serde_json::json!({"b": 2})]
        );
        assert!(r.end().is_ok());
    }

    #[test]
    fn rejects_bad_records() {
        assert!(collect(&mut LineReader::default(), b"{oops}\n").is_err());
        assert!(collect(&mut LineReader::default(), b"\"\xff\"\n").is_err());
        let long = vec![b' '; LINE_LIMIT + 1];
        assert!(collect(&mut LineReader::default(), &long).is_err());
        let mut r = LineReader::default();
        collect(&mut r, b"{\"a\"").unwrap();
        assert!(r.end().is_err());
        assert_eq!(decode("\u{feff}1".as_bytes()), Some(serde_json::json!(1)));
    }
}
