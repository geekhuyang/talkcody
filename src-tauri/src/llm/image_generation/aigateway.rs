use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use crate::llm::types::ProviderConfig;

pub struct AIGatewayImageClient {
    client: OpenAiImageClient,
}

impl AIGatewayImageClient {
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: OpenAiImageClient::new(config),
        }
    }

    pub async fn generate(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        self.client.generate(api_keys, model, request).await
    }
}
