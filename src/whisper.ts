/**
 * Whisper Integration
 * Transcribe audio to text using whisper.cpp directly
 */

import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

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
      console.log(`[Whisper] Salvando áudio temporário: ${tempPath}`);
      // Write original audio
      writeFileSync(tempPath, audioBuffer);

      console.log(`[Whisper] Convertendo para WAV: ${wavPath}`);
      // Convert to 16kHz mono WAV using ffmpeg
      await this.convertToWav(tempPath, wavPath);
      
      // Copy for debugging
      if (existsSync(wavPath)) {
        writeFileSync(debugWavPath, readFileSync(wavPath));
        console.log(`[Whisper] Debug copy salva em: ${debugWavPath}`);
      }

      console.log(`[Whisper] Iniciando transcrição com modelo: ${this.config.model}`);
      // Run whisper-node transcription
      const transcription = await this.runWhisperNode(wavPath);

      console.log(`[Whisper] Transcrição concluída: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
      return transcription;
    } catch (error) {
      console.error('[Whisper] Erro na transcrição:', error);
      console.error(`[Whisper] Arquivo WAV de debug mantido em: ${debugWavPath}`);
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
        reject(new Error(`FFmpeg não encontrado. Instale com: brew install ffmpeg\n${error.message}`));
      });

      child.on('close', (code: number | null) => {
        if (code !== 0) {
          console.error(`[Whisper] FFmpeg stderr: ${stderr}`);
          reject(new Error(`FFmpeg falhou com código ${code}`));
        } else {
          console.log(`[Whisper] FFmpeg conversão OK`);
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
      return Promise.reject(new Error(
        'Whisper binary not found. Run: bash scripts/setup.sh to compile whisper.cpp'
      ));
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
      return Promise.reject(new Error(
        `Whisper model not found: ${modelPath}\nRun: bash scripts/setup.sh to download models`
      ));
    }

    // Validate input audio file
    if (!existsSync(audioPath)) {
      return Promise.reject(new Error(`Audio file not found: ${audioPath}`));
    }
    
    return new Promise((resolve, reject) => {
      const args = [
        '-m', modelPath,
        '-l', this.config.language || 'pt',
        '-f', audioPath,
        '--no-timestamps'
      ];
      
      console.log(`[Whisper] Executando: ${this.whisperBinary} ${args.join(' ')}`);
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
        
        console.log(`[Whisper] Resultado: "${result}"`);
        
        if (!result || result.length === 0) {
          reject(new Error('Nenhuma fala detectada no áudio. Verifique se o áudio contém voz clara ou tente um áudio mais longo.'));
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
