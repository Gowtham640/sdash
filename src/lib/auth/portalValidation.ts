import { spawn } from "child_process";
import { PortalValidationResult, AuthErrorCode } from "./types";

/**
 * Validates user credentials against the college portal using Selenium scraper
 * @param email - User email/portal login ID
 * @param password - User password
 * @returns Validation result with success status and optional error
 */
export async function validatePortalCredentials(
  email: string,
  password: string
): Promise<PortalValidationResult> {
  return new Promise((resolve) => {
    // Timeout protection - max 35 seconds
    const timeoutHandle = setTimeout(() => {
      console.error("[Auth] Portal validation timeout after 35 seconds");
      resolve({
        valid: false,
        error: "Portal validation timed out (35s)",
        errorCode: AuthErrorCode.PORTAL_TIMEOUT,
      });
    }, 35000);

    try {
      console.log(`[Auth] Starting portal validation for: ${email}`);
      console.log(`[Auth] Current working directory: ${process.cwd()}`);

      // Spawn Python scraper process
      const pythonProcess = spawn("python", [
        "python-scraper/api_wrapper.py",
      ], {
        cwd: process.cwd(),
        shell: true,
      });

      let outputData = "";
      let errorData = "";
      let processStarted = false;

      // Prepare input payload for the Python script
      const inputPayload = JSON.stringify({
        action: "validate_credentials",
        email,
        password,
      });

      console.log(`[Auth] Sending payload to Python: ${inputPayload}`);

      // Send credentials to Python process
      pythonProcess.stdin.write(inputPayload);
      pythonProcess.stdin.end();
      processStarted = true;

      // Capture stdout
      pythonProcess.stdout.on("data", (data) => {
        const chunk = data.toString();
        outputData += chunk;
        console.log(`[Auth] Python stdout chunk: ${chunk.substring(0, 200)}`);
      });

      // Capture stderr for logging
      pythonProcess.stderr.on("data", (data) => {
        const chunk = data.toString();
        errorData += chunk;
        console.error(`[Python Scraper stderr] ${chunk.trim()}`);
      });

      // Handle process completion
      pythonProcess.on("close", (code) => {
        clearTimeout(timeoutHandle);

        console.log(`[Auth] Python process closed with code: ${code}`);
        console.log(`[Auth] Total stdout length: ${outputData.length} bytes`);
        console.log(`[Auth] Total stderr length: ${errorData.length} bytes`);

        if (code !== 0) {
          console.error(
            `[Auth] Python scraper exited with code ${code}`
          );
          console.error(`[Auth] stderr output: ${errorData}`);
          console.error(`[Auth] stdout output: ${outputData}`);
          
          resolve({
            valid: false,
            error: `Portal validation failed (exit code ${code}). Check server logs.`,
            errorCode: AuthErrorCode.PORTAL_LOGIN_FAILED,
          });
          return;
        }

        // Try to extract JSON from output (in case there's extra logging)
        try {
          console.log(`[Auth] Raw Python output: ${outputData}`);
          
          // Find JSON in the output (look for {})
          const jsonMatch = outputData.match(/\{[\s\S]*\}/);
          const jsonString = jsonMatch ? jsonMatch[0] : outputData;
          
          console.log(`[Auth] Extracted JSON: ${jsonString}`);
          const response = JSON.parse(jsonString);

          if (response.success === true) {
            console.log(`[Auth] Portal validation successful for: ${email}`);
            resolve({
              valid: true,
              email,
            });
          } else {
            console.error(
              `[Auth] Portal validation failed: ${response.error || "Unknown error"}`
            );
            resolve({
              valid: false,
              error:
                response.error || "Invalid credentials",
              errorCode: AuthErrorCode.INVALID_CREDENTIALS,
            });
          }
        } catch (parseError) {
          console.error(
            `[Auth] Failed to parse Python response. Parse error: ${parseError}`
          );
          console.error(`[Auth] Raw output was: ${outputData}`);
          console.error(`[Auth] stderr was: ${errorData}`);
          
          resolve({
            valid: false,
            error: "Failed to parse portal response. Check server logs.",
            errorCode: AuthErrorCode.PORTAL_CONNECTION_ERROR,
          });
        }
      });

      // Handle process errors
      pythonProcess.on("error", (error) => {
        clearTimeout(timeoutHandle);
        console.error(`[Auth] Python scraper process error: ${error.message}`);
        console.error(`[Auth] Error stack: ${error.stack}`);
        console.error(`[Auth] Process started: ${processStarted}`);
        
        resolve({
          valid: false,
          error: `Portal connection error: ${error.message}`,
          errorCode: AuthErrorCode.PORTAL_CONNECTION_ERROR,
        });
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      console.error(
        `[Auth] Portal validation exception: ${error instanceof Error ? error.message : String(error)}`
      );
      resolve({
        valid: false,
        error: "Internal validation error",
        errorCode: AuthErrorCode.INTERNAL_ERROR,
      });
    }
  });
}
