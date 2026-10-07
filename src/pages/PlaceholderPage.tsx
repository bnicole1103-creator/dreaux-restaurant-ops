// page-designer-instrumented
import { ScreenText } from "../components/ScreenText"
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section data-design-block="copy.64adc1cfa50656c2.1">
      <div data-design-block="copy.b89df849335bdcab.1" className="page-heading">
        <p data-design-block="copy.669342825089223c.1" className="eyebrow"><ScreenText id="PlaceholderPage.710c19aa51b76ee8">Coming module</ScreenText></p>
        <h1 data-design-block="copy.c83b254c37184a95.1">{title}</h1>
      </div>
    </section>
  )
}
