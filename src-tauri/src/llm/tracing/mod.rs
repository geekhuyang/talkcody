// LLM Tracing module
// Provides non-blocking telemetry collection for LLM operations
// Following OpenTelemetry GenAI semantic conventions

pub mod ids;
pub mod schema;
pub mod types;
pub mod writer;

pub use ids::{generate_event_id, generate_span_id, generate_trace_id};
pub use schema::init_tracing_schema;
pub use types::{
    attributes, bool_attr, float_attr, int_attr, json_attr, string_attr, Span, SpanEvent, Trace,
    TraceCommand, BATCH_SIZE, BATCH_TIMEOUT_MS, CHANNEL_CAPACITY,
};
// Re-export TraceContext from llm/types for consistency
pub use crate::llm::types::TraceContext;
pub use writer::TraceWriter;

use std::collections::HashMap;

/// Helper struct for managing span lifecycle
/// Automatically closes the span when dropped
pub struct TracingSpan {
    span_id: String,
    trace_id: String,
    writer: TraceWriter,
    closed: bool,
}

impl TracingSpan {
    /// Create a new tracing span and start it
    pub fn new(
        writer: &TraceWriter,
        trace_id: String,
        parent_span_id: Option<String>,
        name: String,
        attributes: HashMap<String, serde_json::Value>,
    ) -> Self {
        let span_id = writer.start_span(trace_id.clone(), parent_span_id, name, attributes);

        Self {
            span_id,
            trace_id,
            writer: writer.clone(),
            closed: false,
        }
    }

    /// Get the span ID
    pub fn span_id(&self) -> &str {
        &self.span_id
    }

    /// Get the trace ID
    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }

    /// Add an event to this span
    pub fn add_event(&self, event_type: impl Into<String>, payload: Option<serde_json::Value>) {
        self.writer
            .add_event(self.span_id.clone(), event_type.into(), payload);
    }

    /// Create a child span
    pub fn create_child(
        &self,
        writer: &TraceWriter,
        name: String,
        attributes: HashMap<String, serde_json::Value>,
    ) -> TracingSpan {
        TracingSpan::new(
            writer,
            self.trace_id.clone(),
            Some(self.span_id.clone()),
            name,
            attributes,
        )
    }

    /// Manually close the span
    pub fn close(&mut self) {
        if !self.closed {
            let ended_at = chrono::Utc::now().timestamp_millis();
            self.writer.end_span(self.span_id.clone(), ended_at);
            self.closed = true;
        }
    }
}

impl Drop for TracingSpan {
    fn drop(&mut self) {
        self.close();
    }
}

/// Builder for creating traces with proper context
pub struct TraceBuilder {
    writer: TraceWriter,
    trace_id: String,
    root_span_name: String,
    root_span_attributes: HashMap<String, serde_json::Value>,
}

impl TraceBuilder {
    /// Create a new trace builder
    pub fn new(writer: &TraceWriter, root_span_name: impl Into<String>) -> Self {
        let trace_id = writer.start_trace();

        Self {
            writer: writer.clone(),
            trace_id,
            root_span_name: root_span_name.into(),
            root_span_attributes: HashMap::new(),
        }
    }

    /// Create a new trace builder with a specific trace ID
    pub fn with_trace_id(
        writer: &TraceWriter,
        trace_id: String,
        root_span_name: impl Into<String>,
    ) -> Self {
        Self {
            writer: writer.clone(),
            trace_id,
            root_span_name: root_span_name.into(),
            root_span_attributes: HashMap::new(),
        }
    }

    /// Add an attribute to the root span
    pub fn with_attribute(mut self, key: impl Into<String>, value: serde_json::Value) -> Self {
        self.root_span_attributes.insert(key.into(), value);
        self
    }

    /// Build and start the trace, returning the root span
    pub fn build(self) -> TracingSpan {
        TracingSpan::new(
            &self.writer,
            self.trace_id,
            None,
            self.root_span_name,
            self.root_span_attributes,
        )
    }

    /// Get the trace ID
    pub fn trace_id(&self) -> &str {
        &self.trace_id
    }
}

/// Helper functions for common tracing operations
pub mod helpers {
    use super::*;

    /// Create a trace for stream completion
    pub fn start_stream_completion_trace(
        writer: &TraceWriter,
        model: impl Into<String>,
        provider: impl Into<String>,
    ) -> TraceBuilder {
        let mut builder = TraceBuilder::new(writer, attributes::SPAN_STREAM_COMPLETION);

        builder = builder
            .with_attribute(attributes::GEN_AI_REQUEST_MODEL, string_attr(model))
            .with_attribute(attributes::GEN_AI_SYSTEM, string_attr(provider));

        builder
    }

    /// Add request parameters to span attributes
    pub fn add_request_params(
        attributes: &mut HashMap<String, serde_json::Value>,
        temperature: Option<f32>,
        top_p: Option<f32>,
        top_k: Option<i32>,
        max_tokens: Option<i32>,
    ) {
        if let Some(t) = temperature {
            attributes.insert(
                attributes::GEN_AI_REQUEST_TEMPERATURE.to_string(),
                float_attr(t as f64),
            );
        }
        if let Some(p) = top_p {
            attributes.insert(
                attributes::GEN_AI_REQUEST_TOP_P.to_string(),
                float_attr(p as f64),
            );
        }
        if let Some(k) = top_k {
            attributes.insert(
                attributes::GEN_AI_REQUEST_TOP_K.to_string(),
                int_attr(k as i64),
            );
        }
        if let Some(m) = max_tokens {
            attributes.insert(
                attributes::GEN_AI_REQUEST_MAX_TOKENS.to_string(),
                int_attr(m as i64),
            );
        }
    }

    /// Add usage information to span attributes
    pub fn add_usage(
        attributes: &mut HashMap<String, serde_json::Value>,
        input_tokens: i32,
        output_tokens: i32,
        total_tokens: Option<i32>,
        cached_input_tokens: Option<i32>,
        cache_creation_input_tokens: Option<i32>,
    ) {
        attributes.insert(
            attributes::GEN_AI_USAGE_INPUT_TOKENS.to_string(),
            int_attr(input_tokens as i64),
        );
        attributes.insert(
            attributes::GEN_AI_USAGE_OUTPUT_TOKENS.to_string(),
            int_attr(output_tokens as i64),
        );

        if let Some(t) = total_tokens {
            attributes.insert(
                attributes::GEN_AI_USAGE_TOTAL_TOKENS.to_string(),
                int_attr(t as i64),
            );
        }
        if let Some(c) = cached_input_tokens {
            attributes.insert(
                attributes::GEN_AI_USAGE_CACHED_INPUT_TOKENS.to_string(),
                int_attr(c as i64),
            );
        }
        if let Some(c) = cache_creation_input_tokens {
            attributes.insert(
                attributes::GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS.to_string(),
                int_attr(c as i64),
            );
        }
    }

    /// Add finish reason to span attributes
    pub fn add_finish_reason(
        attributes: &mut HashMap<String, serde_json::Value>,
        finish_reason: impl Into<String>,
    ) {
        attributes.insert(
            attributes::GEN_AI_RESPONSE_FINISH_REASONS.to_string(),
            string_attr(finish_reason),
        );
    }

    /// Add error information to span attributes
    pub fn add_error(
        attributes: &mut HashMap<String, serde_json::Value>,
        error_type: impl Into<String>,
        error_message: impl Into<String>,
    ) {
        attributes.insert(attributes::ERROR_TYPE.to_string(), string_attr(error_type));
        attributes.insert(
            attributes::ERROR_MESSAGE.to_string(),
            string_attr(error_message),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::TempDir;

    async fn create_test_setup() -> (TraceWriter, Arc<crate::database::Database>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test_mod.db");
        let db = Arc::new(crate::database::Database::new(
            db_path.to_string_lossy().to_string(),
        ));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        // Initialize schema
        schema::init_tracing_schema(&db).await.unwrap();

        let writer = TraceWriter::new(db.clone());
        writer.start();
        (writer, db, temp_dir)
    }

    #[tokio::test]
    async fn test_tracing_span_lifecycle() {
        let (writer, db, _temp_dir) = create_test_setup().await;

        // First create a trace (spans need a valid trace due to FK constraint)
        let trace_id = writer.start_trace();

        // Create a span
        let span = TracingSpan::new(
            &writer,
            trace_id.clone(),
            None,
            "test.span".to_string(),
            HashMap::new(),
        );

        let span_id = span.span_id().to_string();

        // Add an event
        span.add_event("test.event", Some(serde_json::json!({"data": "value"})));

        // Drop the span to close it
        drop(span);

        // Wait for writes
        writer.request_flush();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // Verify span exists and is closed
        let result = db
            .query(
                "SELECT id, ended_at FROM spans WHERE id = ?",
                vec![serde_json::Value::String(span_id)],
            )
            .await;
        assert!(result.is_ok());
        let rows = result.unwrap().rows;
        assert_eq!(rows.len(), 1, "Span should exist in database");
        assert!(rows[0]["ended_at"].is_number(), "Span should be closed");
    }

    #[tokio::test]
    async fn test_tracing_span_manual_close() {
        let (writer, db, _temp_dir) = create_test_setup().await;

        // First create a trace
        let trace_id = writer.start_trace();

        let mut span = TracingSpan::new(
            &writer,
            trace_id.clone(),
            None,
            "test.span".to_string(),
            HashMap::new(),
        );

        let span_id = span.span_id().to_string();

        // Wait for span creation to complete
        writer.request_flush();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Manually close
        span.close();
        assert!(span.closed);

        // Wait for close to complete
        writer.request_flush();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Verify span is closed
        let result = db
            .query(
                "SELECT ended_at FROM spans WHERE id = ?",
                vec![serde_json::Value::String(span_id)],
            )
            .await;
        assert!(result.is_ok());
        let query_result = result.unwrap();
        assert_eq!(query_result.rows.len(), 1, "Span should exist");
        assert!(query_result.rows[0]["ended_at"].is_number());

        // Dropping already-closed span should not panic
        drop(span);
    }

    #[tokio::test]
    async fn test_child_span() {
        let (writer, db, _temp_dir) = create_test_setup().await;

        // First create a trace
        let trace_id = writer.start_trace();

        let parent = TracingSpan::new(
            &writer,
            trace_id.clone(),
            None,
            "parent.span".to_string(),
            HashMap::new(),
        );

        let parent_id = parent.span_id().to_string();

        // Create child
        let child = parent.create_child(&writer, "child.span".to_string(), HashMap::new());

        let child_id = child.span_id().to_string();

        // Drop both
        drop(child);
        drop(parent);

        // Wait for writes
        writer.request_flush();
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // Verify child has correct parent
        let result = db
            .query(
                "SELECT parent_span_id FROM spans WHERE id = ?",
                vec![serde_json::Value::String(child_id.clone())],
            )
            .await;
        assert!(result.is_ok(), "Query should succeed");
        let query_result = result.unwrap();
        assert_eq!(query_result.rows.len(), 1, "Child span should exist");
        assert_eq!(
            query_result.rows[0]["parent_span_id"],
            serde_json::Value::String(parent_id)
        );
    }

    #[tokio::test]
    async fn test_trace_builder() {
        let (writer, db, _temp_dir) = create_test_setup().await;

        let root = TraceBuilder::new(&writer, "root.span")
            .with_attribute("custom.key", string_attr("custom.value"))
            .build();

        let span_id = root.span_id().to_string();

        drop(root);

        // Wait for writes
        writer.request_flush();
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        // Verify span has the attribute
        let result = db
            .query(
                "SELECT attributes FROM spans WHERE id = ?",
                vec![serde_json::Value::String(span_id)],
            )
            .await;
        assert!(result.is_ok());
        let query_result = result.unwrap();
        let attrs_str = query_result.rows[0]["attributes"].as_str().unwrap();
        let attrs: HashMap<String, serde_json::Value> = serde_json::from_str(attrs_str).unwrap();
        assert_eq!(
            attrs.get("custom.key"),
            Some(&serde_json::Value::String("custom.value".to_string()))
        );
    }

    #[tokio::test]
    async fn test_helpers() {
        let (writer, _db, _temp_dir) = create_test_setup().await;

        // Test start_stream_completion_trace
        let builder = helpers::start_stream_completion_trace(&writer, "gpt-4", "openai");
        assert_eq!(builder.root_span_name, "llm.stream_completion");

        // Test add_request_params
        let mut attrs = HashMap::new();
        helpers::add_request_params(&mut attrs, Some(0.7), Some(0.9), Some(50), Some(2000));
        assert!(attrs.contains_key("gen_ai.request.temperature"));
        assert!(attrs.contains_key("gen_ai.request.max_tokens"));

        // Test add_usage
        let mut attrs = HashMap::new();
        helpers::add_usage(&mut attrs, 100, 50, Some(150), Some(25), Some(10));
        assert_eq!(
            attrs.get("gen_ai.usage.input_tokens"),
            Some(&serde_json::Value::Number(100.into()))
        );
        assert_eq!(
            attrs.get("gen_ai.usage.output_tokens"),
            Some(&serde_json::Value::Number(50.into()))
        );

        // Test add_finish_reason
        let mut attrs = HashMap::new();
        helpers::add_finish_reason(&mut attrs, "stop");
        assert_eq!(
            attrs.get("gen_ai.response.finish_reasons"),
            Some(&serde_json::Value::String("stop".to_string()))
        );

        // Test add_error
        let mut attrs = HashMap::new();
        helpers::add_error(&mut attrs, "timeout", "Request timed out");
        assert_eq!(
            attrs.get("error.type"),
            Some(&serde_json::Value::String("timeout".to_string()))
        );
    }
}
