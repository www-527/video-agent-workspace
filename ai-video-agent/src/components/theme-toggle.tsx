'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const THEME_STORAGE_KEY = 'ai-video:appearance:v1';

type Appearance = 'dark' | 'light';

function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance;
  document.documentElement.style.colorScheme = appearance;
}

export function ThemeMenuItem() {
  const [appearance, setAppearance] = useState<Appearance>('dark');

  useEffect(() => {
    const storedAppearance = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextAppearance: Appearance = storedAppearance === 'light' ? 'light' : 'dark';
    setAppearance(nextAppearance);
    applyAppearance(nextAppearance);
  }, []);

  function toggleAppearance() {
    const nextAppearance: Appearance = appearance === 'dark' ? 'light' : 'dark';
    setAppearance(nextAppearance);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextAppearance);
    applyAppearance(nextAppearance);
  }

  const isLight = appearance === 'light';
  const appearanceLabel = isLight ? '日间模式' : '夜间模式';

  return (
    <DropdownMenuItem
      className="theme-menu-item justify-between"
      onSelect={event => {
        event.preventDefault();
        if (!(event.target instanceof Element && event.target.closest('[role="switch"]'))) {
          toggleAppearance();
        }
      }}
      aria-label={`外观：${appearanceLabel}`}
      title={`外观：${appearanceLabel}`}
      suppressHydrationWarning
    >
      <span className="flex items-center gap-2">
        <span className="theme-menu-icon" aria-hidden="true">
          <Sun className="theme-toggle-sun" />
          <Moon className="theme-toggle-moon" />
        </span>
        <span>外观</span>
      </span>
      <Switch
        checked={isLight}
        className="theme-appearance-switch"
        onCheckedChange={checked => {
          const nextAppearance: Appearance = checked ? 'light' : 'dark';
          if (nextAppearance !== appearance) toggleAppearance();
        }}
        aria-label={`切换至${isLight ? '夜间' : '日间'}模式`}
        title={`切换至${isLight ? '夜间' : '日间'}模式`}
      />
    </DropdownMenuItem>
  );
}
