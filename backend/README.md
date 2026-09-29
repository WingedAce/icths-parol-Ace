# I-Parol segmentation backend

One endpoint: `POST /segment` — upload a digital line-art drawing (PNG/JPG),
get back every enclosed zone as a polygon.

No ML/training — pure image processing (threshold → dilate → connected
components → contour extraction), per the project's locked design decision.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then test it:

```bash
curl -X POST http://localhost:8000/segment -F "file=@your_drawing.png"
```

## Deploy (Render or Railway free tier)

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- No environment variables required.
- Once deployed, set `VITE_SEGMENT_API_URL` in the frontend's `.env` to
  `https://<your-deployed-url>/segment`.

## Response shape

```json
{
  "width": 480,
  "height": 480,
  "zone_count": 384,
  "zones": [
    { "id": "z2", "points": [[216,33],[216,35], ...], "cx": 227.0, "cy": 33.5, "area": 73 }
  ]
}
```
