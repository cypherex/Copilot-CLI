//! Network protocol for broker-worker communication

use crate::error::{Result, TaskQueueError};
use bytes::{Buf, BufMut, BytesMut};
use tokio_util::codec::{Decoder, Encoder};

/// Message frame format: 4-byte length prefix (big-endian) | 1-byte message type | payload
#[derive(Debug, Clone)]
pub struct MessageFrame {
    /// Message type byte
    pub message_type: u8,
    /// Message payload
    pub payload: Vec<u8>,
}

impl MessageFrame {
    /// Create a new message frame
    pub fn new(message_type: u8, payload: Vec<u8>) -> Self {
        Self {
            message_type,
            payload,
        }
    }

    /// Get the total size of this frame (including length prefix)
    pub fn total_size(&self) -> usize {
        4 + 1 + self.payload.len()
    }
}

/// Codec for encoding/decoding message frames
pub struct MessageCodec;

impl MessageCodec {
    /// Maximum frame size (16MB)
    const MAX_FRAME_SIZE: usize = 16 * 1024 * 1024;
}

impl Decoder for MessageCodec {
    type Item = MessageFrame;
    type Error = TaskQueueError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>> {
        // Need at least 5 bytes (4 for length, 1 for message type)
        if src.len() < 5 {
            return Ok(None);
        }

        // Read length prefix (big-endian u32)
        let length = u32::from_be_bytes([src[0], src[1], src[2], src[3]]) as usize;

        // Validate length
        if length > Self::MAX_FRAME_SIZE {
            return Err(TaskQueueError::Other(format!(
                "Frame size {} exceeds maximum {}",
                length,
                Self::MAX_FRAME_SIZE
            )));
        }

        // Check if we have the complete frame
        let total_size = 4 + 1 + length;
        if src.len() < total_size {
            return Ok(None);
        }

        // Extract frame data
        src.advance(4); // Skip length prefix
        let message_type = src[0];
        src.advance(1); // Skip message type
        let payload = src[4..total_size].to_vec();
        src.advance(length);

        Ok(Some(MessageFrame {
            message_type,
            payload,
        }))
    }
}

impl Encoder<MessageFrame> for MessageCodec {
    type Error = TaskQueueError;

    fn encode(&mut self, item: MessageFrame, dst: &mut BytesMut) -> Result<()> {
        let payload_len = item.payload.len();
        let total_size = 4 + 1 + payload_len;

        // Reserve space
        dst.reserve(total_size);

        // Write length prefix (big-endian)
        dst.put_u32(payload_len as u32);

        // Write message type
        dst.put_u8(item.message_type);

        // Write payload
        dst.put_slice(&item.payload);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_frame_creation() {
        let frame = MessageFrame::new(1, b"test".to_vec());
        assert_eq!(frame.message_type, 1);
        assert_eq!(frame.payload, b"test");
        assert_eq!(frame.total_size(), 9); // 4 + 1 + 4
    }

    #[test]
    fn test_codec_roundtrip() {
        let mut codec = MessageCodec;
        let original = MessageFrame::new(5, b"hello world".to_vec());

        let mut encoded = BytesMut::new();
        codec.encode(original.clone(), &mut encoded).unwrap();

        let decoded = codec.decode(&mut encoded).unwrap().unwrap();
        assert_eq!(decoded.message_type, original.message_type);
        assert_eq!(decoded.payload, original.payload);
    }

    #[test]
    fn test_codec_incomplete_frame() {
        let mut codec = MessageCodec;
        let mut src = BytesMut::from(&b"\x00\x00\x00\x05\x01hello"[..]);

        // First decode should return None (not enough data)
        assert!(codec.decode(&mut src).unwrap().is_none());

        // Complete the frame
        src.extend_from_slice(b" world");
        let decoded = codec.decode(&mut src).unwrap().unwrap();
        assert_eq!(decoded.payload, b"hello world");
    }

    #[test]
    fn test_codec_max_frame_size() {
        let mut codec = MessageCodec;
        let mut src = BytesMut::new();

        // Write a frame that's too large
        let huge_size = MessageCodec::MAX_FRAME_SIZE + 1;
        src.put_u32(huge_size as u32);
        src.put_u8(1);

        let result = codec.decode(&mut src);
        assert!(result.is_err());
    }
}
