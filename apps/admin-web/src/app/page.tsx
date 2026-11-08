'use client';

import { useEffect, useState } from 'react';
import { LoginScreen } from '../../../desktop/src/renderer/LoginScreen';
import { installWebBridge } from '../web-bridge';

export default function Home() {
  const [ready, setReady] = useState(false);
  useEffect(() => { installWebBridge(); setReady(true); }, []);
  return ready ? <LoginScreen platform="web" /> : <main role="status" className="p-8">Opening POS…</main>;
}
