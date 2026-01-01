//! Message protocol handler for broker communication.

use task_queue_core::message::Message;
use std::io;

/// Handles message protocol encoding/decoding.
pub struct MessageHandler;

impl MessageHandler {
    /// Encode a message for transmission.
    pub fn encode(msg: &Message) -> io::Result<Vec<u8>> {
        msg.to_bytes()
    }

    /// Decode a message from bytes.
    pub fn decode(bytes: &[u8]) -> io::Result<(Message, usize)> {
        Message::from_bytes(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use task_queue_core::message::MessageType;

    #[test]
    fn test_encode_decode() {
        let msg = Message::new(MessageType::Heartbeat, b"test".to_vec());
        let bytes = MessageHandler::encode(&msg).unwrap();
        let (decoded, _) = MessageHandler::decode(&bytes).unwrap();

        assert_eq!(decoded.msg_type, msg.msg_type);
        assert_eq!(decoded.payload, msg.payload);
    }
}
