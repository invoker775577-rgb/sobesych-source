function isValidRegion(region, displayBounds, minimum = 20) {
  return Boolean(region && displayBounds &&
    [region.x, region.y, region.width, region.height, displayBounds.width, displayBounds.height].every(Number.isFinite) &&
    region.x >= 0 && region.y >= 0 && region.width >= minimum && region.height >= minimum &&
    displayBounds.width > 0 && displayBounds.height > 0 &&
    region.x + region.width <= displayBounds.width && region.y + region.height <= displayBounds.height)
}

function mapRegionToImage(region, displayBounds, imageSize) {
  if (!isValidRegion(region, displayBounds) || !imageSize || imageSize.width < 1 || imageSize.height < 1) return null
  const scaleX = imageSize.width / displayBounds.width
  const scaleY = imageSize.height / displayBounds.height
  const x = Math.max(0, Math.floor(region.x * scaleX))
  const y = Math.max(0, Math.floor(region.y * scaleY))
  const right = Math.min(imageSize.width, Math.ceil((region.x + region.width) * scaleX))
  const bottom = Math.min(imageSize.height, Math.ceil((region.y + region.height) * scaleY))
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

module.exports = { isValidRegion, mapRegionToImage }
