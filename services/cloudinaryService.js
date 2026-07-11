import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

export async function uploadPhoto(base64DataUrl, partyCode) {
  if (!base64DataUrl?.startsWith('data:image')) {
    throw new Error('Invalid base64 image')
  }
  
  const folder = `${process.env.CLOUDINARY_UPLOAD_FOLDER}/${partyCode}`
  
  const result = await cloudinary.uploader.upload(base64DataUrl, {
    folder,
    resource_type: 'image',
    // ★ RGPD C4 fix — Strip ALL metadata (EXIF, IPTC, XMP, ICC profiles) from the
    // stored original. Removes GPS coordinates, camera info, timestamps.
    // Rationale: Privacy Policy V1 promises "aucune coordonnée GPS collectée".
    // Without this flag, iPhone photos would leak the host's home location via EXIF GPS.
    // Note: Cloudinary auto-strips on delivery transformations, but force_strip
    // ensures the ORIGINAL stored asset is also clean (defense in depth).
    transformation: [
      { flags: 'force_strip' },
      { width: 1080, height: 1080, crop: 'limit' },
      { quality: 'auto:good' },
      { format: 'auto' }
    ]
  })
  
  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    bytes: result.bytes
  }
}

export async function deletePhoto(publicId) {
  return cloudinary.uploader.destroy(publicId)
}
