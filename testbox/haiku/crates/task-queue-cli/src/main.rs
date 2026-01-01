mod commands;

use commands::Cli;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let _cli = Cli::parse_args();
    println!("Task Queue Admin CLI");
    Ok(())
}
