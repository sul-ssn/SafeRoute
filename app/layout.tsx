import type { Metadata } from 'next';
import './globals.css';
import './redesign.css';
import 'leaflet/dist/leaflet.css';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'SafeRoute — городская безопасность',
  description: 'Карта событий, маршруты и аналитика с прозрачным происхождением данных.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body><AppShell>{children}</AppShell></body></html>;
}
