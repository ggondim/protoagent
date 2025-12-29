/**
 * Whisper Integration
 * Transcribe audio to text using whisper.cpp directly
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { t } from './i18n/index.js';

const TEMP_DIR = join(process.cwd(), 'data', 'temp');

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

export interface WhisperConfig {
  model: string;
  language?: string;
}

export class WhisperTranscriber {
  private config: WhisperConfig;
  private whisperBinary: string;

  constructor(config: WhisperConfig) {
    this.config = config;
    
    // Detect whisper.cpp paths (handles different installation locations)
    const whisperBasePath = join(process.cwd(), 'node_modules', 'whisper-node', 'lib', 'whisper.cpp');
    this.whisperBinary = join(whisperBasePath, 'main');
    
    // Validate whisper binary exists
    if (!existsSync(this.whisperBinary)) {
      console.error(`[Whisper] Binary not found at: ${this.whisperBinary}`);
      console.error('[Whisper] Run: bash scripts/setup.sh to compile whisper.cpp');
    }
  }

  /**
   * Transcribe audio buffer to text
   */
  async transcribe(audioBuffer: Buffer, filename: string = 'audio.ogg'): Promise<string> {
    // Save audio to temporary file
    const tempPath = join(TEMP_DIR, `${Date.now()}_${filename}`);
    // Convert to WAV for whisper-node (requires 16kHz WAV)
    const wavPath = tempPath.replace(/\.[^.]+$/, '.wav');
    // Keep a copy for debugging
    const debugWavPath = join(TEMP_DIR, 'last_voice.wav');

    try {
      console.log(`[Whisper] Saving temporary audio: ${tempPath}`);
      // Write original audio
      writeFileSync(tempPath, audioBuffer);

      console.log(`[Whisper] Converting to WAV: ${wavPath}`);
      // Convert to 16kHz mono WAV using ffmpeg
      await this.convertToWav(tempPath, wavPath);
      
      // Copy for debugging
      if (existsSync(wavPath)) {
        writeFileSync(debugWavPath, readFileSync(wavPath));
        console.log(`[Whisper] Debug copy saved at: ${debugWavPath}`);
      }

      console.log(`[Whisper] Starting transcription with model: ${this.config.model}`);
      // Run whisper-node transcription
      const transcription = await this.runWhisperNode(wavPath);

      console.log(`[Whisper] Transcription completed: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
      return transcription;
    } catch (error) {
      console.error('[Whisper] Transcription error:', error);
      console.error(`[Whisper] Debug WAV file kept at: ${debugWavPath}`);
      throw error;
    } finally {
      // Clean up temp files (but keep debug copy)
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
      if (existsSync(wavPath)) {
        unlinkSync(wavPath);
      }
    }
  }

  /**
   * Convert audio to 16kHz mono WAV using ffmpeg
   */
  private async convertToWav(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-ar', '16000',      // Sample rate: 16kHz
        '-ac', '1',          // Mono channel
        '-c:a', 'pcm_s16le', // PCM 16-bit little-endian
        '-f', 'wav',         // Force WAV format
        '-y',                // Overwrite output
        outputPath
      ];

      console.log(`[Whisper] FFmpeg args: ${args.join(' ')}`);
      const child = spawn('ffmpeg', args);

      let stderr = '';

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('error', (error: Error) => {
        reject(new Error(t('whisper:errors.ffmpeg_not_found') + `\n${error.message}`));
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          console.error(`[Whisper] FFmpeg stderr: ${stderr}`);
          reject(new Error(t('whisper:errors.ffmpeg_failed', { code })));
        } else {
          console.log(`[Whisper] FFmpeg conversion OK`);
          resolve();
        }
      });
    });
  }

  /**
   * Run whisper.cpp transcription directly
   */
  private async runWhisperNode(audioPath: string): Promise<string> {
    // Validate binary exists
    if (!existsSync(this.whisperBinary)) {
      return Promise.reject(new Error(t('whisper:errors.binary_not_found')));
    }

    // Construct model path
    const modelPath = join(
      process.cwd(),
      'node_modules',
      'whisper-node',
      'lib',
      'whisper.cpp',
      'models',
      `ggml-${this.config.model}.bin`
    );

    // Validate model exists
    if (!existsSync(modelPath)) {
      return Promise.reject(new Error(t('whisper:errors.model_not_found', { path: modelPath })));
    }

    // Validate input audio file
    if (!existsSync(audioPath)) {
      return Promise.reject(new Error(t('whisper:errors.audio_not_found', { path: audioPath })));
    }
    
    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-l', this.config.language || 'pt',
        '-f', audioPath,
        '--no-timestamps'
      ];
      
      console.log(`[Whisper] Executing: ${this.whisperBinary} ${args.join(' ')}`);
      const child = spawn(this.whisperBinary, args);
      
      let stdout = '';
      let stderr = '';
      
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      
      child.on('error', (error: Error) => {
        reject(new Error(
          `Failed to execute whisper binary: ${error.message}\n` +
          `Binary path: ${this.whisperBinary}\n` +
          'Ensure whisper.cpp is compiled for your platform (run: bash scripts/setup.sh)'
        ));
      });
      
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          console.error(`[Whisper] stderr: ${stderr}`);
          const errorMsg = stderr.includes('No such file') || stderr.includes('cannot execute')
            ? 'Whisper binary incompatible or missing. Run: bash scripts/setup.sh to recompile'
            : `Whisper exited with code ${code}`;
          reject(new Error(errorMsg));
          return;
        }
        
        // Extract transcript from output
        // With --no-timestamps, the output is clean text after filtering system messages
        const lines = stdout.split('\n');
        const transcriptLines = lines
          .filter(line => {
            const trimmed = line.trim();
            // Skip empty lines and system messages
            return trimmed.length > 0 &&
                   !trimmed.startsWith('whisper_') &&
                   !trimmed.startsWith('ggml_') &&
                   !trimmed.startsWith('main:') &&
                   !trimmed.startsWith('system_info') &&
                   !trimmed.includes('load time') &&
                   !trimmed.includes('mel time') &&
                   !trimmed.includes('sample time');
          })
          .map(line => line.trim());
        
        const result = transcriptLines.join(' ').trim();

        console.log(`[Whisper] Result: "${result}"`);

        if (!result || result.length === 0) {
          reject(new Error(t('whisper:errors.no_speech_detected')));
          return;
        }
        
        resolve(result);
      });
    });
  }

  /**
   * Check if whisper.cpp and ffmpeg are available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if whisper binary exists
      if (!existsSync(this.whisperBinary)) {
        console.warn('[Whisper] Binary not found - run setup script');
        return false;
      }

      // Check if ffmpeg is available
      const ffmpegAvailable = await new Promise<boolean>((resolve) => {
        const child = spawn('ffmpeg', ['-version']);
        child.on('error', () => resolve(false));
        child.on('close', (code: number | null) => resolve(code === 0));
      });

      if (!ffmpegAvailable) {
        console.warn('[Whisper] FFmpeg not found - install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}
