import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { supabase } from './supabase';

/** Signs in anonymously (once) and makes sure an `installs` row exists. */
export async function ensureInstall(): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  let user = sessionData.session?.user;
  if (!user) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.user) throw error ?? new Error('Anonymous sign-in failed');
    user = data.user;
  }
  const { error } = await supabase.from('installs').upsert(
    {
      id: user.id,
      platform: Platform.OS,
      app_version: Application.nativeApplicationVersion,
      device_model: Device.modelName,
      os_version: Device.osVersion,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;
  return user.id;
}
