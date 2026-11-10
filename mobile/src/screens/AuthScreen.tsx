import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/client';
import { useApp } from '../AppContext';

export function AuthScreen() {
  const { api, signIn } = useApp();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await api.login(email.trim(), password);
      else await api.register(email.trim(), password);
      await signIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>PaperTrade</Text>
      <Text style={styles.subtitle}>Practice trading with virtual money</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={styles.input} placeholder="Password (8+ characters)" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={[styles.button, busy && styles.disabled]} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === 'login' ? 'Log in' : 'Create account'}</Text>}
      </Pressable>
      <Pressable onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
        <Text style={styles.link}>{mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#f9fafb' },
  title: { fontSize: 32, fontWeight: '700', textAlign: 'center' },
  subtitle: { textAlign: 'center', color: '#6b7280', marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, marginBottom: 12, backgroundColor: '#fff' },
  button: { backgroundColor: '#2563eb', padding: 14, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600' },
  link: { color: '#2563eb', textAlign: 'center', marginTop: 16 },
  error: { color: '#dc2626', marginBottom: 8 },
});
