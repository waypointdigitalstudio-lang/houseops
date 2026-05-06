export interface PmSection {
  title: string;
  color: string;
  checks: string[];
}

export const PM_SECTIONS: PmSection[] = [
  { title: "1. System Boot",       color: "#1F5C2E", checks: ["Cold Boot OK"] },
  { title: "2. System Login",      color: "#1A4971", checks: ["Login OK", "Login Script OK"] },
  { title: "3. Network Settings",  color: "#4A235A", checks: ["TCP/IP Correct", "Domain Name OK", "Firewall/Security OK", "Client Config OK", "Computer Name OK"] },
  { title: "4. Hardware Settings", color: "#7B3F00", checks: ["Device Manager OK", "BIOS Up-to-Date", "Hard Disk Space OK", "Memory OK", "Device Drivers OK", "Battery Runtime OK (Laptop)"] },
  { title: "5. Browser / Proxy",   color: "#1C4E6B", checks: ["Browser/Proxy OK"] },
  { title: "6. Software",          color: "#2E5C1F", checks: ["Required Software OK", "Software Settings OK"] },
  { title: "7. Security",          color: "#7B0000", checks: ["No Viruses/Malware", "CrowdStrike Installed", "ManageEngine Agent"] },
  { title: "8. Clearance",         color: "#5C2222", checks: ["Unused Software Removed", "Temp Files Cleared", "Recycle/Cache Cleared", "Periphery Devices Clean"] },
  { title: "9. Cleaning",          color: "#1F3864", checks: ["Dust Removed", "No Loose Parts", "Airflow OK", "Cables Re-seated", "Fans Operating"] },
  { title: "10. Peripherals",      color: "#4A235A", checks: ["Mouse OK", "Keyboard OK", "Monitor OK", "UPS OK", "Printer OK"] },
];

export const ALL_CHECKS = PM_SECTIONS.flatMap((s) => s.checks);
// 30 checks total
