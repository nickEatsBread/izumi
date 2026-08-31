import '@fontsource/nunito-sans/latin-400.css'
import '@fontsource/nunito-sans/latin-600.css'
import '@fontsource/nunito-sans/latin-700.css'
import '@fontsource/nunito-sans/latin-800.css'
import { render } from 'preact'
import { App } from './App'
import './styles.css'

render(<App />, document.getElementById('app')!)
