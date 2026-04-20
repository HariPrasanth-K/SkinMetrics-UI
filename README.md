# DermAI – Skin Analysis and Vital Signs Monitoring Application
## SkinMetrics-UI Dashboard

## Overview

DermAI is a React-based web application that performs skin condition analysis and estimates vital signs using machine learning models deployed on AWS. The application integrates with Amazon S3 for data storage and Amazon SageMaker for real-time inference.

It provides two primary capabilities:

- Skin condition analysis using image-based models  
- Vital signs estimation using remote photoplethysmography (rPPG) from a 60-second facial video  

---

## Features

### Skin Analysis
- Load and browse images directly from Amazon S3
- Supports multiple categories: acne, pigmentation, wrinkles, and others
- View raw and annotated images
- Parse and display annotation data (COCO, LabelMe, custom formats)
- Run inference via SageMaker endpoints
- Display prediction scores, severity levels, and recommendations

### Vital Signs Monitoring (rPPG)
- Capture 60-second facial video using the browser camera
- Send video data to SageMaker endpoint for processing
- Extract and display:
  - Heart rate
  - Respiratory rate
  - Oxygen saturation
  - Blood pressure
  - Stress index
  - Heart rate variability (HRV)
  - Hemoglobin
  - HbA1c
- Generate printable report
- Enable email-based result sharing

---

## Architecture

### AWS Services Used

- Amazon S3  
  Stores dataset images, annotation files, and model artifacts  

- Amazon SageMaker  
  Hosts machine learning models for inference  

- AWS SDK (JavaScript v3)  
  Handles communication with S3 and SageMaker  

---

## Project Structure
src/

├── components/

│ ├── Sidebar.css

│ └── Sidebar.jsx

│
├── pages/

│ ├── Login.css

│ ├── Login.jsx

│ ├── SkinAnalysis.css

│ ├── SkinAnalysis.jsx

│ ├── VitalSigns.css

│ └── VitalSigns.jsx

│
├── App.css

├── App.jsx

├── awsConfig.js

├── main.jsx

│
├── .env

├── .gitignore

├── index.html

├── package-lock.json

├── package.json

└── vite.config.js


---

## Requirements

### System Requirements
- Node.js >= 18
- npm >= 9
- Modern browser (Chrome recommended for camera support)

### AWS Requirements
- AWS account with access to:
  - S3 (ListBucket, GetObject permissions)
  - SageMaker Runtime (InvokeEndpoint)
- At least one deployed SageMaker endpoint for:
  - Skin analysis
  - rPPG inference

### Environment Variables

Create a `.env` file in the root directory:
VITE_AWS_REGION=ap-south-1
VITE_S3_BUCKET=your-bucket-name

VITE_AWS_ACCESS_KEY_ID=your-access-key
VITE_AWS_SECRET_ACCESS_KEY=your-secret-key

VITE_ENDPOINT_ACNE=
VITE_ENDPOINT_PIGMENT=
VITE_ENDPOINT_WRINKLES=
VITE_ENDPOINT_OTHERS=

VITE_RPPG_ENDPOINT=

---

## Usage

### Skin Analysis
1. Select a category  
2. Choose an image from the dataset  
3. View annotations (if available)  
4. Run prediction using configured endpoint  
5. View results  

### Vital Signs
1. Configure rPPG endpoint  
2. Start 60-second face scan  
3. Allow camera access  
4. Wait for processing  
5. View results and generate report  

---

## Security Considerations

This project uses AWS credentials directly in the frontend via environment variables. This approach is not secure for production.

Recommended improvements:
- Use API Gateway with Lambda for backend communication  
- Store credentials securely on the server  
- Implement authentication (e.g., AWS Cognito)  

---

## Future Improvements

- Backend API layer for secure communication  
- User authentication and authorization  
- Improved UI responsiveness  
- Historical data tracking  
- Advanced visualization and analytics  

---

## Disclaimer

This application is intended for research and development purposes only. It should not be used for medical diagnosis or treatment.

---

## Author

Hari Prasanth K

---


