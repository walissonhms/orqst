//! Port of `output.ts`: inert bytes only, a bounded replay ring with cursor and gap.
pub const READ_BYTES: usize = 64 * 1024;

pub struct TerminalOutput {
    bytes: Vec<u8>,
    end: u64,
    limit: usize,
}

pub struct Read {
    pub bytes: Vec<u8>,
    pub next_cursor: u64,
    pub gap: bool,
}

impl TerminalOutput {
    pub fn new(limit: usize) -> Result<Self, &'static str> {
        if limit < 1 || limit > 1024 * 1024 {
            return Err("Invalid terminal replay limit");
        }
        Ok(Self {
            bytes: Vec::new(),
            end: 0,
            limit,
        })
    }

    pub fn end(&self) -> u64 {
        self.end
    }

    pub fn append(&mut self, data: &[u8]) {
        self.end += data.len() as u64;
        if data.len() >= self.limit {
            self.bytes = data[data.len() - self.limit..].to_vec();
        } else {
            let keep = (self.bytes.len() + data.len()).saturating_sub(self.limit);
            self.bytes.drain(..keep);
            self.bytes.extend_from_slice(data);
        }
    }

    pub fn read(&self, cursor: u64) -> Result<Read, &'static str> {
        if cursor > self.end || cursor > 9_007_199_254_740_991 {
            return Err("Invalid terminal output cursor");
        }
        let start = self.end - self.bytes.len() as u64;
        let offset = start.max(cursor);
        let from = (offset - start) as usize;
        let to = (from + READ_BYTES).min(self.bytes.len());
        let bytes = self.bytes[from..to].to_vec();
        Ok(Read {
            next_cursor: offset + bytes.len() as u64,
            gap: cursor < start,
            bytes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_keeps_the_tail_and_reports_gaps() {
        let mut output = TerminalOutput::new(8).unwrap();
        output.append(b"abcdef");
        output.append(b"ghij");
        let read = output.read(0).unwrap();
        assert_eq!(read.bytes, b"cdefghij");
        assert!(read.gap);
        assert_eq!(read.next_cursor, 10);
        let read = output.read(4).unwrap();
        assert_eq!(read.bytes, b"efghij");
        assert!(!read.gap);
        assert!(output.read(11).is_err());
        output.append(b"0123456789");
        assert_eq!(output.read(20).unwrap().bytes, b"");
        assert_eq!(output.read(12).unwrap().bytes, b"23456789");
    }
}
