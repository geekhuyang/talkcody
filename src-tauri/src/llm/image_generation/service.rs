use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::aigateway::AIGatewayImageClient;
use crate::llm::image_generation::google::GoogleImageClient;
use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::types::{ImageGenerationRequest, ImageGenerationResponse};
use crate::llm::models::model_registry::ModelRegistry;
use crate::llm::providers::provider_registry::ProviderRegistry;
use crate::llm::types::CustomProvidersConfiguration;
use crate::llm::types::ModelsConfiguration;

pub struct ImageGenerationService;

impl ImageGenerationService {
    pub async fn generate(
        api_keys: &ApiKeyManager,
        registry: &ProviderRegistry,
        custom_providers: &CustomProvidersConfiguration,
        models: &ModelsConfiguration,
        request: ImageGenerationRequest,
    ) -> Result<ImageGenerationResponse, String> {
        let api_map = api_keys.load_api_keys().await?;

        let (model_key, provider_id) = ModelRegistry::get_model_provider(
            &request.model,
            &api_map,
            registry,
            custom_providers,
            models,
        )?;

        let provider_model_name =
            ModelRegistry::resolve_provider_model_name(&model_key, &provider_id, models);

        match provider_id.as_str() {
            "openai" => {
                let provider = registry
                    .provider(&provider_id)
                    .ok_or_else(|| "OpenAI provider not configured".to_string())?;
                let client = OpenAiImageClient::new(provider.clone());
                let images = client
                    .generate(api_keys, &provider_model_name, request)
                    .await?;
                Ok(ImageGenerationResponse {
                    provider: provider_id,
                    images,
                    request_id: None,
                })
            }
            "aiGateway" => {
                let provider = registry
                    .provider(&provider_id)
                    .ok_or_else(|| "aiGateway provider not configured".to_string())?;
                let client = AIGatewayImageClient::new(provider.clone());
                let images = client
                    .generate(api_keys, &provider_model_name, request)
                    .await?;
                Ok(ImageGenerationResponse {
                    provider: provider_id,
                    images,
                    request_id: None,
                })
            }
            "google" => {
                let provider = registry
                    .provider(&provider_id)
                    .ok_or_else(|| "Google provider not configured".to_string())?;
                let client = GoogleImageClient::with_base_url(provider.base_url.clone());
                let images = client
                    .generate(api_keys, &provider_model_name, request)
                    .await?;
                Ok(ImageGenerationResponse {
                    provider: provider_id,
                    images,
                    request_id: None,
                })
            }
            _ => Err(format!(
                "Image generation provider not supported: {} / 不支持的图片生成供应商: {}",
                provider_id, provider_id
            )),
        }
    }
}
