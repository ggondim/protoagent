/**
 * Type declarations for whisper-node
 */

declare module 'whisper-node' {
  interface WhisperSegment {
    start: string;
    end: string;
    speech: string;
  }

  interface WhisperOptions {
    modelName?: string;
    modelPath?: string;
    whisperOptions?: {
      language?: string;
      word_timestamps?: boolean;
      gen_file_txt?: boolean;
      gen_file_subtitle?: boolean;
      gen_file_vtt?: boolean;
      timestamp_size?: number;
    };
  }

  function whisper(filePath: string, options?: WhisperOptions): Promise<WhisperSegment[]>;

  export default whisper;
}
