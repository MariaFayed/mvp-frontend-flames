import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import TeacherPage from "./TeacherPage";
import StudentPage from "./StudentPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/teacher" element={<TeacherPage />} />
        <Route path="/student" element={<StudentPage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
