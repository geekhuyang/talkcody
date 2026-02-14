use crate::llm::auth::api_key_manager::ApiKeyManager;
use crate::llm::image_generation::types::{GeneratedImage, ImageGenerationRequest};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
struct GeminiImageRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Clone, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum GeminiPart {
    #[serde(rename = "text")]
    Text { text: String },
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiImageResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCandidate {
    content: GeminiCandidateContent,
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiCandidateContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum GeminiResponsePart {
    InlineData { inline_data: GeminiInlineData },
    Text { text: String },
}

#[derive(Debug, Clone, Deserialize)]
struct GeminiInlineData {
    #[serde(rename = "mime_type")]
    mime_type: String,
    data: String,
}

pub struct GoogleImageClient {
    base_url: String,
}

impl GoogleImageClient {
    pub fn new() -> Self {
        Self {
            base_url: "https://generativelanguage.googleapis.com/v1beta".to_string(),
        }
    }

    pub fn with_base_url(base_url: String) -> Self {
        Self { base_url }
    }

    pub async fn generate(
        &self,
        api_keys: &ApiKeyManager,
        model: &str,
        request: ImageGenerationRequest,
    ) -> Result<Vec<GeneratedImage>, String> {
        let api_key = api_keys
            .get_setting(&format!("api_key_{}", "google"))
            .await?
            .unwrap_or_default();

        if api_key.is_empty() {
            return Err(
                "Google API key not configured for image generation / Google 图片生成未配置 API 密钥"
                    .to_string(),
            );
        }

        let payload = GeminiImageRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart::Text {
                    text: request.prompt,
                }],
            }],
        };

        let url = format!(
            "{}/models/{}:generateContent?key={}",
            self.base_url.trim_end_matches('/'),
            model,
            api_key
        );

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Google image request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "Google image generation failed ({}): {} / Google 图片生成失败",
                status, body
            ));
        }

        let payload = response
            .json::<GeminiImageResponse>()
            .await
            .map_err(|e| format!("Failed to parse Google response: {}", e))?;

        let mut images = Vec::new();
        for candidate in payload.candidates {
            for part in candidate.content.parts {
                if let GeminiResponsePart::InlineData { inline_data } = part {
                    images.push(GeneratedImage {
                        b64_json: Some(inline_data.data),
                        url: None,
                        mime_type: inline_data.mime_type,
                        revised_prompt: None,
                    });
                }
            }
        }

        Ok(images)
    }
}

impl Default for GoogleImageClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gemini_image_response() {
        let json = r#"{"candidates":[{"content":{"parts":[{"inline_data":{"mime_type":"image/png","data":"abc"}}]}}]}"#;
        let parsed: GeminiImageResponse = serde_json::from_str(json).expect("parse response");
        assert_eq!(parsed.candidates.len(), 1);
        match &parsed.candidates[0].content.parts[0] {
            GeminiResponsePart::InlineData { inline_data } => {
                assert_eq!(inline_data.mime_type, "image/png");
                assert_eq!(inline_data.data, "abc");
            }
            _ => panic!("expected inline data"),
        }
    }
}
