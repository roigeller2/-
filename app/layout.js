import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'מערכת תיאום אימונים משותפים',
  description: 'תיאום אימונים משותפים בין טייסות מסוקים לכוחות קרקעיים',
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
