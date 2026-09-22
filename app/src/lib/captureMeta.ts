import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import type { VideoFile } from 'react-native-vision-camera';

// The fixed camera recording target (SPEC section 4). Written into every capture_meta
// so the actual (from VideoFile/ffprobe) can be compared against what we asked for.
export const CAPTURE_TARGET = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoBitRateMbps: 10,
  codec: 'h264' as const,
};

export interface CaptureMeta {
  device_brand: string | null;
  device_model: string | null;
  os_name: string | null;
  os_version: string | null;
  camera_facing: 'front' | 'back';
  requested_width: number;
  requested_height: number;
  requested_fps: number;
  requested_codec: string;
  requested_bit_rate_mbps: number;
  actual_width: number;
  actual_height: number;
  actual_duration_seconds: number;
  app_version: string | null;
  source: 'camera' | 'gallery';
}

export function buildCameraCaptureMeta(video: VideoFile, facing: 'front' | 'back'): CaptureMeta {
  return {
    device_brand: Device.brand,
    device_model: Device.modelName,
    os_name: Device.osName,
    os_version: Device.osVersion,
    camera_facing: facing,
    requested_width: CAPTURE_TARGET.width,
    requested_height: CAPTURE_TARGET.height,
    requested_fps: CAPTURE_TARGET.fps,
    requested_codec: CAPTURE_TARGET.codec,
    requested_bit_rate_mbps: CAPTURE_TARGET.videoBitRateMbps,
    actual_width: video.width,
    actual_height: video.height,
    actual_duration_seconds: video.duration,
    app_version: Application.nativeApplicationVersion,
    source: 'camera',
  };
}

export const platformOS = Platform.OS;
