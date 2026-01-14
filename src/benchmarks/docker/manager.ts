/**
 * Docker environment manager
 * Handles container creation, setup, and cleanup for benchmark execution
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface DockerConfig {
  image: string;
  containerName?: string;
  workdir: string;
  volumes?: Record<string, string>; // host -> container mappings
  env?: Record<string, string>;
  timeout?: number; // seconds
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class DockerManager {
  private containers: Map<string, string> = new Map(); // id -> containerName

  /**
   * Check if Docker is available
   */
  static isDockerAvailable(): boolean {
    try {
      execSync('docker --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Build a Docker image
   */
  static async buildImage(
    imageTag: string,
    dockerfilePath: string,
    buildContext: string = path.dirname(dockerfilePath)
  ): Promise<void> {
    console.log(`🔨 Building Docker image: ${imageTag}`);

    try {
      execSync(`docker build -t ${imageTag} -f ${dockerfilePath} ${buildContext}`, {
        stdio: 'inherit',
      });
      console.log(`✓ Docker image built: ${imageTag}`);
    } catch (error) {
      throw new Error(`Failed to build Docker image: ${error}`);
    }
  }

  /**
   * Create and start a container
   */
  async createContainer(config: DockerConfig): Promise<string> {
    const containerId = this.generateContainerId();
    const containerName = config.containerName || containerId;

    console.log(`🚀 Creating container: ${containerName}`);

    const volumeArgs = Object.entries(config.volumes || {})
      .map(([host, container]) => `-v ${host}:${container}`)
      .join(' ');

    const envArgs = Object.entries(config.env || {})
      .map(([key, value]) => `-e ${key}="${value}"`)
      .join(' ');

    const command = `docker run -d --name ${containerName} -w ${config.workdir} ${volumeArgs} ${envArgs} ${config.image} sleep infinity`;

    try {
      execSync(command, { stdio: 'pipe' });
      this.containers.set(containerId, containerName);
      console.log(`✓ Container created: ${containerName}`);
      return containerName;
    } catch (error) {
      throw new Error(`Failed to create container: ${error}`);
    }
  }

  /**
   * Execute a command inside a container
   */
  async executeInContainer(
    containerName: string,
    command: string,
    timeout: number = 300
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeout} seconds`));
      }, timeout * 1000);

      try {
        // Use inherit to see real-time output during long operations like pip install
        const stdout = execSync(`docker exec ${containerName} sh -c "${command}"`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'inherit', 'inherit'], // stdin: pipe, stdout: inherit, stderr: inherit
        });

        clearTimeout(timer);
        resolve({
          exitCode: 0,
          stdout,
          stderr: '',
        });
      } catch (error: any) {
        clearTimeout(timer);
        resolve({
          exitCode: error.status || 1,
          stdout: error.stdout?.toString() || '',
          stderr: error.stderr?.toString() || '',
        });
      }
    });
  }

  /**
   * Copy file to container
   */
  async copyToContainer(containerName: string, hostPath: string, containerPath: string): Promise<void> {
    try {
      execSync(`docker cp ${hostPath} ${containerName}:${containerPath}`, {
        stdio: 'pipe',
      });
    } catch (error) {
      throw new Error(`Failed to copy file to container: ${error}`);
    }
  }

  /**
   * Copy file from container
   */
  async copyFromContainer(containerName: string, containerPath: string, hostPath: string): Promise<void> {
    try {
      execSync(`docker cp ${containerName}:${containerPath} ${hostPath}`, {
        stdio: 'pipe',
      });
    } catch (error) {
      throw new Error(`Failed to copy file from container: ${error}`);
    }
  }

  /**
   * Stop container
   */
  async stopContainer(containerName: string): Promise<void> {
    try {
      execSync(`docker stop ${containerName}`, { stdio: 'pipe' });
      console.log(`✓ Container stopped: ${containerName}`);
    } catch (error) {
      console.warn(`Warning: Failed to stop container: ${error}`);
    }
  }

  /**
   * Remove container
   */
  async removeContainer(containerName: string): Promise<void> {
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' });
      console.log(`✓ Container removed: ${containerName}`);
    } catch (error) {
      console.warn(`Warning: Failed to remove container: ${error}`);
    }
  }

  /**
   * Clean up all containers
   */
  async cleanup(): Promise<void> {
    for (const containerName of this.containers.values()) {
      await this.removeContainer(containerName);
    }
    this.containers.clear();
  }

  /**
   * Generate unique container ID
   */
  private generateContainerId(): string {
    return `benchmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Utility function to check if running on Docker
 */
export function isRunningInDocker(): boolean {
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }
  try {
    const cgroupContent = fs.readFileSync('/proc/self/cgroup', 'utf-8');
    return cgroupContent.includes('docker');
  } catch {
    return false;
  }
}

/**
 * Utility function to get Docker socket path (for Docker-in-Docker)
 */
export function getDockerSocketPath(): string {
  const envPath = process.env.DOCKER_SOCKET_PATH;
  if (envPath) {
    return envPath;
  }

  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\docker_engine';
  } else if (process.platform === 'darwin') {
    return path.join(os.homedir(), '.docker/run/docker.sock');
  } else {
    return '/var/run/docker.sock';
  }
}
