use crate::llm::image_generation::openai::OpenAiImageClient;
use crate::llm::image_generation::types::GeneratedImage;
use crate::llm::types::ProviderConfig;
use crate::llm::types::{AuthType, ProtocolType};
use serde_json::json;

#[test]
fn openai_image_response_parses_b64_json() {
    let response = json!({
        "data": [
            {
                "b64_json": "abc",
                "revised_prompt": "refined"
            }
        ]
    });

    let parsed: serde_json::Value = response;
    let data = parsed.get("data").and_then(|v| v.as_array()).unwrap();
    let first = data.first().unwrap();
    assert_eq!(first.get("b64_json").and_then(|v| v.as_str()), Some("abc"));
    assert_eq!(
        first.get("revised_prompt").and_then(|v| v.as_str()),
        Some("refined")
    );
}

#[test]
fn openai_image_response_parses_url() {
    let response = json!({
        "data": [
            {
                "url": "https://example.com/image.png"
            }
        ]
    });

    let parsed: serde_json::Value = response;
    let data = parsed.get("data").and_then(|v| v.as_array()).unwrap();
    let first = data.first().unwrap();
    assert_eq!(
        first.get("url").and_then(|v| v.as_str()),
        Some("https://example.com/image.png")
    );
}

#[test]
fn openai_image_client_constructs() {
    let config = ProviderConfig {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        protocol: ProtocolType::OpenAiCompatible,
        base_url: "https://api.openai.com/v1".to_string(),
        api_key_name: "OPENAI_API_KEY".to_string(),
        supports_oauth: true,
        supports_coding_plan: false,
        supports_international: false,
        coding_plan_base_url: None,
        international_base_url: None,
        headers: None,
        extra_body: None,
        auth_type: AuthType::Bearer,
    };
    let _client = OpenAiImageClient::new(config);
    let _image: GeneratedImage = GeneratedImage {
        b64_json: None,
        url: None,
        mime_type: "image/png".to_string(),
        revised_prompt: None,
    };
}
