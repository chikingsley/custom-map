# Auto Custom Map for Dust Permit

AI-powered tool to overlay construction plans, SWPPP plans, and site plans on Google Maps satellite imagery for dust permit applications.

## Features

- **PDF Upload**: Drag & drop or click to upload plan PDFs
- **AI Analysis**: Uses Gemini to extract location info and auto-position the overlay
- **Iterative Refinement**: AI can analyze screenshots and suggest position adjustments
- **Manual Controls**: Drag corner handles to resize/reposition, adjust opacity
- **Real-time Updates**: Watch the AI think and adjust in real-time

## Setup

### Prerequisites

- [Bun](https://bun.sh) runtime
- Google Maps API key
- Google Gemini API key

### Environment Variables

Create a `.env` file:

```bash
GOOGLE_MAPS_API_KEY=your_maps_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash  # optional, defaults to gemini-2.5-flash

```text

### Installation

```bash
bun install

```text

### Development

```bash
bun dev

```text

### Production

```bash
bun start

```text

## How It Works

1. **Upload a Plan**: Drop a PDF file onto the map or use the upload panel
2. **AI Analysis**: The AI extracts location information (addresses, coordinates, landmarks) from the plan
3. **Auto-Positioning**: If location data is found, the overlay is automatically positioned
4. **Manual Adjustment**: Drag the corner handles to fine-tune position and size
5. **AI Refinement**: Click "Refine" to have the AI analyze the current view and suggest improvements

## Tech Stack

- **Runtime**: Bun
- **Frontend**: React 19, Tailwind CSS 4, shadcn/ui
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps
- **PDF Rendering**: PDF.js
- **Screenshots**: html2canvas
- **AI**: Google Gemini API

## License

MIT
