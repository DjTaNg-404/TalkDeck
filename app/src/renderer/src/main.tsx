import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from './context/AppContext'
import App from './App'

// 跟随系统深色模式：main 进程会在 did-finish-load 立即推送一次初始值
window.api.dark.onChange((isDark) => {
  document.documentElement.classList.toggle('dark', isDark)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>
)
