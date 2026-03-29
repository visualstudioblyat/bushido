use bushido_lib::dns_resolver;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let port = dns_resolver::start().await.expect("failed to start resolver");
    println!("RESOLVER_PORT={}", port);
    loop { tokio::time::sleep(std::time::Duration::from_secs(3600)).await; }
}
