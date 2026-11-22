pub mod inspect;
pub mod output;
pub mod proxy;
pub mod store;
pub mod ui;
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
