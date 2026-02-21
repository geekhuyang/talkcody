use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub workspace_root: PathBuf,
    pub data_root: PathBuf,
    pub attachments_root: PathBuf,
}

impl ServerConfig {
    pub fn new(workspace_root: PathBuf, data_root: PathBuf) -> Self {
        let attachments_root = data_root.join("attachments");
        Self {
            workspace_root,
            data_root,
            attachments_root,
        }
    }
}
