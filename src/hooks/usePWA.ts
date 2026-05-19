import { useState, useEffect, useRef } from 'react';
import { requestFCMToken } from '../lib/fcm';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePWA(uid: string | null) {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(ios);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    setIsInstalled(standalone);

    if ('Notification' in window) setNotificationPermission(Notification.permission);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setCanInstall(false);
      deferredPrompt.current = null;
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt.current) return;
    await deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    if (outcome === 'accepted') {
      deferredPrompt.current = null;
      setCanInstall(false);
    }
  };

  const enableNotifications = async (): Promise<boolean> => {
    if (isIOS && !isInstalled) {
      alert('لتفعيل الإشعارات على iOS، أضف التطبيق أولاً إلى الشاشة الرئيسية عبر زر المشاركة ثم "إضافة إلى الشاشة الرئيسية".');
      return false;
    }

    const token = await requestFCMToken();
    if ('Notification' in window) setNotificationPermission(Notification.permission);

    if (token && uid) {
      await setDoc(doc(db, 'users', uid), { fcmToken: token }, { merge: true });
    }

    return !!token;
  };

  return { canInstall, isInstalled, isIOS, notificationPermission, promptInstall, enableNotifications };
}
