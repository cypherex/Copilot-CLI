// Filesystem error handling utilities

export interface FilesystemErrorOptions {
  code?: string;
  message?: string;
}

/**
 * Creates a user-friendly error message from a filesystem error
 * @param error - The original error from filesystem operations
 * @param filePath - The file path that caused the error
 * @param operation - The operation being performed (e.g., 'read', 'write', 'create')
 * @returns A new Error with a user-friendly message
 */
export function createFilesystemError(error: any, filePath: string, operation: string): Error {
  const errorMessages: Record<string, string> = {
    'ENOENT': `File not found: ${filePath}`,
    'EACCES': `Permission denied: ${filePath}`,
    'EISDIR': `Path is a directory, not a file: ${filePath}`,
    'ENOSPC': `Disk full: Cannot ${operation} ${filePath}`,
    'EROFS': `Read-only filesystem: ${filePath}`,
    'EMFILE': `Too many open files`,
    'ENOTDIR': `Not a directory: ${filePath}`,
    'EEXIST': `File already exists: ${filePath}`,
  };

  const userMessage = errorMessages[error.code] || `Filesystem error during ${operation} of ${filePath}: ${error.message}`;
  const enhancedError = new Error(userMessage);

  // Preserve original error details for debugging
  (enhancedError as any).code = error.code;
  (enhancedError as any).originalError = error;

  return enhancedError;
}

/**
 * Safely handles filesystem operations with proper error wrapping
 * @param operation - Async function to execute
 * @param filePath - Path being operated on
 * @param operationName - Name of the operation for error messages
 * @returns Result of the operation
 */
export async function safeFilesystemOperation<T>(
  operation: () => Promise<T>,
  filePath: string,
  operationName: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw createFilesystemError(error, filePath, operationName);
  }
}
