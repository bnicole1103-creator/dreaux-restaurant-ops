import { ScreenText } from "../components/ScreenText"
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <section>
      <div className="page-heading">
        <p className="eyebrow"><ScreenText id="PlaceholderPage.710c19aa51b76ee8">Coming module</ScreenText></p>
        <h1>{title}</h1>
      </div>
    </section>
  )
}
