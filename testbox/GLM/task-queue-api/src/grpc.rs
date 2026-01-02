//! gRPC API implementation using tonic

use tonic::{transport::Server, Request, Response, Status};

// TODO: Include generated gRPC code
// use task_queue_proto::task_queue_server::{TaskQueueService, TaskQueueServiceServer};
// use task_queue_proto::*;

/// Create gRPC server
pub async fn create_grpc_server(addr: String) -> Result<(), Box<dyn std::error::Error>> {
    let addr = addr.parse()?;

    // TODO: Create actual gRPC service
    // let task_service = TaskQueueServiceImpl::new();
    // let svc = TaskQueueServiceServer::new(task_service);

    println!("gRPC server listening on {}", addr);

    Server::builder()
        // .add_service(svc)
        .serve(addr)
        .await?;

    Ok(())
}

// TODO: Implement gRPC service
// struct TaskQueueServiceImpl;
//
// #[tonic::async_trait]
// impl TaskQueueService for TaskQueueServiceImpl {
//     async fn submit_task(
//         &self,
//         request: Request<SubmitTaskRequest>,
//     ) -> Result<Response<SubmitTaskResponse>, Status> {
//         // TODO: Implement
//         Ok(Response::new(SubmitTaskResponse {
//             task_id: uuid::Uuid::new_v4().to_string(),
//             status: "pending".to_string(),
//         }))
//     }
// }
