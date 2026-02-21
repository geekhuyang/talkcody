// Compatibility facade for legacy tauri_app_lib crate.

pub use talkcody_desktop_lib::*;

// Preserve legacy module paths for server/core usage in old binaries.
pub mod core {
    pub use talkcody_core::core::*;
    #[allow(unused_imports)]
    pub use talkcody_core::types::*;
}

pub mod llm {
    pub use talkcody_core::llm::*;
}

pub mod storage {
    pub use talkcody_core::storage::*;
}

pub mod git {
    pub use talkcody_core::git::*;
}

pub mod platform {
    pub use talkcody_core::platform::*;
}

pub mod integrations {
    pub use talkcody_core::integrations::*;
}

pub mod security {
    pub use talkcody_core::security::*;
}

pub mod streaming {
    pub use talkcody_core::streaming::*;
}

pub mod server {
    pub use talkcody_server::*;
}
