use crate::{Message, MessageType, ProtocolError, Result, MAX_MESSAGE_SIZE};
use bytes::{Buf, BufMut, BytesMut};
use tokio_util::codec::{Decoder, Encoder};

/// Codec for encoding/decoding messages with length-prefixed framing
///
/// Frame format: [4-byte length (big-endian)] [1-byte message type] [payload]
pub struct MessageCodec;

impl Decoder for MessageCodec {
    type Item = Message;
    type Error = ProtocolError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>> {
        // Need at least 5 bytes for length prefix + message type
        if src.len() < 5 {
            return Ok(None);
        }

        // Read length prefix without consuming
        let mut length_bytes = [0u8; 4];
        length_bytes.copy_from_slice(&src[0..4]);
        let length = u32::from_be_bytes(length_bytes) as usize;

        // Check max message size
        if length > MAX_MESSAGE_SIZE {
            return Err(ProtocolError::MessageTooLarge(length));
        }

        // Wait for complete message
        if src.len() < 4 + length {
            // Reserve space for the full message
            src.reserve(4 + length - src.len());
            return Ok(None);
        }

        // We have a complete message, consume it
        src.advance(4); // Skip length prefix

        // Read message type
        let msg_type_byte = src.get_u8();
        let msg_type = MessageType::from_u8(msg_type_byte)
            .ok_or(ProtocolError::InvalidMessageType(msg_type_byte))?;

        // Read payload
        let payload_len = length - 1; // Subtract message type byte
        let payload = src.split_to(payload_len);

        // Deserialize based on message type
        let message = match msg_type {
            MessageType::SubmitTask => {
                let req = bincode::deserialize(&payload)?;
                Message::SubmitTask(req)
            }
            MessageType::ClaimTask => {
                let req = bincode::deserialize(&payload)?;
                Message::ClaimTask(req)
            }
            MessageType::TaskResult => {
                let req = bincode::deserialize(&payload)?;
                Message::TaskResult(req)
            }
            MessageType::Heartbeat => {
                let req = bincode::deserialize(&payload)?;
                Message::Heartbeat(req)
            }
            MessageType::Ack => {
                let resp = bincode::deserialize(&payload)?;
                Message::Ack(resp)
            }
            MessageType::Nack => {
                let resp = bincode::deserialize(&payload)?;
                Message::Nack(resp)
            }
            MessageType::QueryStatus => {
                let req = bincode::deserialize(&payload)?;
                Message::QueryStatus(req)
            }
        };

        Ok(Some(message))
    }
}

impl Encoder<Message> for MessageCodec {
    type Error = ProtocolError;

    fn encode(&mut self, item: Message, dst: &mut BytesMut) -> Result<()> {
        // Serialize the payload
        let payload = match &item {
            Message::SubmitTask(req) => bincode::serialize(req)?,
            Message::ClaimTask(req) => bincode::serialize(req)?,
            Message::TaskResult(req) => bincode::serialize(req)?,
            Message::Heartbeat(req) => bincode::serialize(req)?,
            Message::Ack(resp) => bincode::serialize(resp)?,
            Message::Nack(resp) => bincode::serialize(resp)?,
            Message::QueryStatus(req) => bincode::serialize(req)?,
        };

        // Check size
        let total_length = 1 + payload.len(); // message type + payload
        if total_length > MAX_MESSAGE_SIZE {
            return Err(ProtocolError::MessageTooLarge(total_length));
        }

        // Reserve space
        dst.reserve(4 + total_length);

        // Write length prefix (message type + payload)
        dst.put_u32(total_length as u32);

        // Write message type
        dst.put_u8(item.message_type().as_u8());

        // Write payload
        dst.put_slice(&payload);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{SubmitTaskRequest, ClaimTaskRequest, AckResponse};
    use task_queue_core::{Task, Priority};

    #[test]
    fn test_codec_roundtrip() {
        let mut codec = MessageCodec;
        let mut buffer = BytesMut::new();

        // Create a test message
        let task = Task::new(
            "test".to_string(),
            b"test payload".to_vec(),
            Priority::normal(),
        ).unwrap();

        let message = Message::SubmitTask(SubmitTaskRequest { task: task.clone() });

        // Encode
        codec.encode(message.clone(), &mut buffer).unwrap();

        // Decode
        let decoded = codec.decode(&mut buffer).unwrap();
        assert!(decoded.is_some());

        match decoded.unwrap() {
            Message::SubmitTask(req) => {
                assert_eq!(req.task.id, task.id);
                assert_eq!(req.task.task_type, task.task_type);
            }
            _ => panic!("Wrong message type"),
        }
    }

    #[test]
    fn test_partial_message() {
        let mut codec = MessageCodec;
        let mut buffer = BytesMut::new();

        let task = Task::new(
            "test".to_string(),
            b"data".to_vec(),
            Priority::high(),
        ).unwrap();

        let message = Message::SubmitTask(SubmitTaskRequest { task });

        // Encode full message
        codec.encode(message, &mut buffer).unwrap();

        // Split buffer - keep only partial message
        let full_len = buffer.len();
        let partial = buffer.split_to(full_len / 2);
        let mut partial_buffer = BytesMut::from(&partial[..]);

        // Should return None (waiting for more data)
        let result = codec.decode(&mut partial_buffer).unwrap();
        assert!(result.is_none());
    }
}
