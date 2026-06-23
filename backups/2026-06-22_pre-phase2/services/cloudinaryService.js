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
    transformation: [
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
