import { useState, useCallback, useRef, useEffect } from 'react';

function useToast(timeout = 3000) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const showToast = useCallback((message, type = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message, type });
    timerRef.current = setTimeout(() => setToast(null), timeout);

    if (type === 'success' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Tools', { body: message, icon: '/favicon.svg' });
    }
  }, [timeout]);

  const hideToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(null);
  }, []);

  return [toast, showToast, hideToast];
}

export default useToast;
