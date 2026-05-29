//! SVG слой: парсим через usvg (внутри vello_svg), конвертим в vello::Scene.

pub fn append_svg(_scene: &mut vello::Scene, _svg_source: &str) -> anyhow::Result<()> {
    // TODO: vello_svg::append(&mut scene, svg_source)?
    Ok(())
}
