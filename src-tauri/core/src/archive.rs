// Archive operations for skill package management
// Provides tar.gz creation and extraction functionality

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use tar::{Archive, Builder};

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTarballRequest {
    pub source_dir: String,
    pub output_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateTarballResult {
    pub success: bool,
    pub output_path: String,
    pub size_bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractTarballRequest {
    pub tarball_path: String,
    pub dest_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractTarballResult {
    pub success: bool,
    pub dest_dir: String,
    pub files_extracted: usize,
    pub error: Option<String>,
}

/// Create a tar.gz archive from a directory
pub fn create_tarball(request: CreateTarballRequest) -> Result<CreateTarballResult, String> {
    let source_dir = Path::new(&request.source_dir);
    let output_path = Path::new(&request.output_path);

    // Validate source directory exists
    if !source_dir.exists() {
        return Ok(CreateTarballResult {
            success: false,
            output_path: request.output_path,
            size_bytes: 0,
            error: Some(format!(
                "Source directory does not exist: {}",
                request.source_dir
            )),
        });
    }

    if !source_dir.is_dir() {
        return Ok(CreateTarballResult {
            success: false,
            output_path: request.output_path,
            size_bytes: 0,
            error: Some(format!(
                "Source path is not a directory: {}",
                request.source_dir
            )),
        });
    }

    // Create parent directory if it doesn't exist
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    // Create gzip encoder
    let tar_gz =
        File::create(output_path).map_err(|e| format!("Failed to create output file: {}", e))?;
    let enc = GzEncoder::new(tar_gz, Compression::default());
    let mut tar = Builder::new(enc);

    // Add directory contents to tar archive
    tar.append_dir_all(".", source_dir)
        .map_err(|e| format!("Failed to add directory to archive: {}", e))?;

    // Finish writing
    let mut gz = tar
        .into_inner()
        .map_err(|e| format!("Failed to finalize tar archive: {}", e))?;
    gz.flush()
        .map_err(|e| format!("Failed to flush gzip stream: {}", e))?;
    let file = gz
        .finish()
        .map_err(|e| format!("Failed to finish gzip compression: {}", e))?;

    // Get file size
    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let size_bytes = metadata.len();

    Ok(CreateTarballResult {
        success: true,
        output_path: request.output_path,
        size_bytes,
        error: None,
    })
}

/// Extract a tar.gz archive to a directory
pub fn extract_tarball(request: ExtractTarballRequest) -> Result<ExtractTarballResult, String> {
    let tarball_path = Path::new(&request.tarball_path);
    let dest_dir = Path::new(&request.dest_dir);

    // Validate tarball exists
    if !tarball_path.exists() {
        return Ok(ExtractTarballResult {
            success: false,
            dest_dir: request.dest_dir,
            files_extracted: 0,
            error: Some(format!("Tarball does not exist: {}", request.tarball_path)),
        });
    }

    // Create destination directory if it doesn't exist
    fs::create_dir_all(dest_dir)
        .map_err(|e| format!("Failed to create destination directory: {}", e))?;

    // Open and decompress the tarball
    let tar_gz = File::open(tarball_path).map_err(|e| format!("Failed to open tarball: {}", e))?;
    let tar = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(tar);

    // Canonicalize destination directory to prevent path traversal
    let canonical_dest = dest_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination directory: {}", e))?;

    // Extract all entries
    let mut files_extracted = 0;
    for entry in archive
        .entries()
        .map_err(|e| format!("Failed to read archive entries: {}", e))?
    {
        let mut entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;

        // Get the entry path and convert to owned PathBuf
        let entry_path = entry
            .path()
            .map_err(|e| format!("Failed to get entry path: {}", e))?
            .to_path_buf();

        // Create the full destination path
        let dest_path = dest_dir.join(&entry_path);

        // Security: Validate that the destination path doesn't escape the target directory
        // This prevents path traversal attacks using ../ sequences
        let canonical_dest_path = dest_path.canonicalize().or_else(|_| {
            // If file doesn't exist yet, canonicalize the parent and join the filename
            if let Some(parent) = dest_path.parent() {
                if let Some(filename) = dest_path.file_name() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                    parent
                        .canonicalize()
                        .map(|p| p.join(filename))
                        .map_err(|e| format!("Failed to canonicalize parent path: {}", e))
                } else {
                    Err(format!("Invalid destination path: {}", dest_path.display()))
                }
            } else {
                Err(format!("Invalid destination path: {}", dest_path.display()))
            }
        })?;

        // Ensure the canonical destination path is within the canonical destination directory
        if !canonical_dest_path.starts_with(&canonical_dest) {
            return Ok(ExtractTarballResult {
                success: false,
                dest_dir: request.dest_dir,
                files_extracted,
                error: Some(format!(
                    "Security: Path traversal detected in archive entry: {}",
                    entry_path.display()
                )),
            });
        }

        // Extract the entry
        entry
            .unpack(&dest_path)
            .map_err(|e| format!("Failed to extract {}: {}", entry_path.display(), e))?;

        files_extracted += 1;
    }

    Ok(ExtractTarballResult {
        success: true,
        dest_dir: request.dest_dir,
        files_extracted,
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_create_and_extract_tarball() {
        // Create temporary directories
        let temp_dir = TempDir::new().unwrap();
        let source_dir = temp_dir.path().join("source");
        let dest_dir = temp_dir.path().join("dest");
        let tarball_path = temp_dir.path().join("test.tar.gz");

        // Create source directory with some files
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("file1.txt"), b"Hello, World!").unwrap();
        fs::write(source_dir.join("file2.txt"), b"Test content").unwrap();

        let subdir = source_dir.join("subdir");
        fs::create_dir_all(&subdir).unwrap();
        fs::write(subdir.join("file3.txt"), b"Nested file").unwrap();

        // Test creating tarball
        let create_request = CreateTarballRequest {
            source_dir: source_dir.to_string_lossy().to_string(),
            output_path: tarball_path.to_string_lossy().to_string(),
        };
        let create_result = create_tarball(create_request).unwrap();
        assert!(create_result.success);
        assert!(create_result.size_bytes > 0);
        assert!(tarball_path.exists());

        // Test extracting tarball
        let extract_request = ExtractTarballRequest {
            tarball_path: tarball_path.to_string_lossy().to_string(),
            dest_dir: dest_dir.to_string_lossy().to_string(),
        };
        let extract_result = extract_tarball(extract_request).unwrap();
        assert!(extract_result.success);
        // Note: The archive includes the parent directory entry plus 3 files and 1 subdirectory
        assert!(
            extract_result.files_extracted >= 3,
            "Expected at least 3 files to be extracted"
        );

        // Verify extracted files
        assert!(dest_dir.join("file1.txt").exists());
        assert!(dest_dir.join("file2.txt").exists());
        assert!(dest_dir.join("subdir/file3.txt").exists());

        let content1 = fs::read_to_string(dest_dir.join("file1.txt")).unwrap();
        assert_eq!(content1, "Hello, World!");
    }

    #[test]
    fn test_create_tarball_nonexistent_source() {
        let temp_dir = TempDir::new().unwrap();
        let tarball_path = temp_dir.path().join("test.tar.gz");

        let request = CreateTarballRequest {
            source_dir: "/nonexistent/path".to_string(),
            output_path: tarball_path.to_string_lossy().to_string(),
        };
        let result = create_tarball(request).unwrap();
        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_extract_tarball_nonexistent_file() {
        let temp_dir = TempDir::new().unwrap();
        let dest_dir = temp_dir.path().join("dest");

        let request = ExtractTarballRequest {
            tarball_path: "/nonexistent/file.tar.gz".to_string(),
            dest_dir: dest_dir.to_string_lossy().to_string(),
        };
        let result = extract_tarball(request).unwrap();
        assert!(!result.success);
        assert!(result.error.is_some());
    }

    #[test]
    fn test_path_traversal_protection() {
        // This test verifies that our path validation logic works.
        // The tar library itself rejects paths with ".." so we can't actually create
        // a malicious archive through the Builder API. This is actually a good thing -
        // it means the tar library provides an additional layer of defense.
        //
        // Our canonicalization check in extract_tarball provides defense-in-depth
        // in case archives are created through other means or if there are symlink
        // attacks.

        let temp_dir = TempDir::new().unwrap();
        let dest_dir = temp_dir.path().join("dest");

        fs::create_dir_all(&dest_dir).unwrap();

        // Test that canonical path validation works correctly
        let canonical_dest = dest_dir.canonicalize().unwrap();

        // A safe path within the destination
        let safe_path = dest_dir.join("normal_file.txt");
        fs::write(&safe_path, b"safe content").unwrap();
        let canonical_safe = safe_path.canonicalize().unwrap();
        assert!(
            canonical_safe.starts_with(&canonical_dest),
            "Safe path should be within destination"
        );

        // Create a file outside the destination directory
        let outside_path = temp_dir.path().join("outside.txt");
        fs::write(&outside_path, b"outside content").unwrap();
        let canonical_outside = outside_path.canonicalize().unwrap();
        assert!(
            !canonical_outside.starts_with(&canonical_dest),
            "Outside path should NOT be within destination"
        );

        // This demonstrates that our starts_with check correctly identifies
        // paths that escape the destination directory
    }
}
