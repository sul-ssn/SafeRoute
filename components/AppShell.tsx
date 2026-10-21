'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BarChart3, Database, Map, Menu, Route, X } from 'lucide-react';
import { useState } from 'react';

const links = [
  { href: '/map', label: 'Карта', icon: Map },
  { href: '/route', label: 'Навигатор', icon: Route },
  { href: '/analytics', label: 'Аналитика', icon: BarChart3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const mapFocused = pathname === '/map' || pathname === '/route';
  return <>
    <header className="topbar">
      <Link className="brand" href="/" aria-label="SafeRoute — главная"><span className="brand-mark"><Activity size={17}/></span><span>safe<span>route</span></span></Link>
      <nav className={menuOpen ? 'main-nav nav-open' : 'main-nav'} aria-label="Основная навигация">
        {links.map(({href,label,icon:Icon}) => <Link key={href} className={pathname === href ? 'nav-link active' : 'nav-link'} href={href} aria-current={pathname === href ? 'page' : undefined} onClick={()=>setMenuOpen(false)}><Icon size={16}/>{label}</Link>)}
        <Link className={pathname.startsWith('/admin') ? 'nav-link active nav-admin' : 'nav-link nav-admin'} href="/admin/imports" onClick={()=>setMenuOpen(false)}><Database size={16}/>Данные</Link>
      </nav>
      <div className="topbar-right"><span className="demo-pill"><i/>QAMQOR</span><button className="mobile-menu" onClick={()=>setMenuOpen(!menuOpen)} aria-label={menuOpen?'Закрыть меню':'Открыть меню'}>{menuOpen?<X size={21}/>:<Menu size={21}/>}</button></div>
    </header>
    {!mapFocused && pathname !== '/' && <div className="demo-notice"><span className="notice-dot"/>Показаны доступные записи Qamqor. Неполнота данных не означает отсутствие событий.</div>}
    {children}
  </>;
}
