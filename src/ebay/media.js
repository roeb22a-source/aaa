// Commerce Media API: Bild hochladen und eBay-Bild-URL erhalten.
import { ebayFetch, hosts, EbayError } from './http.js';
import { getUserToken } from './auth.js';

export async function uploadImage(buffer, filename = 'bild.jpg') {
  const token = await getUserToken();
  const fd = new FormData();
  fd.append('image', new Blob([buffer], { type: 'image/jpeg' }), filename);
  const { res, data } = await ebayFetch(`${hosts().media}/commerce/media/v1_beta/image/create_image_from_file`, {
    method: 'POST',
    token,
    body: fd,
    expect: 'response',
    timeout: 120000,
  });
  if (data?.imageUrl) return data.imageUrl;
  const loc = res.headers.get('location');
  if (!loc) throw new EbayError(500, [{ message: 'eBay hat keine Bild-Adresse zurückgegeben (image)' }]);
  const info = await ebayFetch(loc, { token });
  if (!info.imageUrl) throw new EbayError(500, [{ message: 'eBay hat keine Bild-URL geliefert (image)' }]);
  return info.imageUrl;
}
