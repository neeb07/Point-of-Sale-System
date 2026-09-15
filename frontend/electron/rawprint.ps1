# Send a file's bytes to a Windows printer untouched.
#
# The printer's own driver is left exactly where it is. A job submitted with
# the RAW datatype goes through the spooler and out of the port without the
# driver rendering it — which is the point: the bytes are already ESC/POS, and
# the driver's job is only to deliver them. This is how every receipt-printing
# application on Windows talks to a thermal printer, and it is why the client's
# previous software prints correctly on the same machine.
#
# Nothing to install and no driver to replace. The alternative libraries reach
# the printer over USB directly, which on Windows means detaching the vendor
# driver with Zadig first — and then nothing else on that PC can print to it.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File rawprint.ps1 -Printer "BC-87AC" -File job.bin
#
# Exit code 0 on success. Anything else, with the reason on stderr.

param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$File,
  [string]$JobName = "Blaze receipt"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $File)) {
  [Console]::Error.WriteLine("No such file: $File")
  exit 2
}

# winspool.drv, the same calls the spooler API exposes to every application.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr handle, int level, ref DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

  public static int Send(string printer, byte[] bytes, string jobName) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return -1;
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = jobName;
      di.pOutputFile = null;
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, ref di) == 0) return -2;
      try {
        if (!StartPagePrinter(h)) return -3;
        int written;
        bool ok = WritePrinter(h, bytes, bytes.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != bytes.Length) return -4;
        return written;
      } finally {
        EndDocPrinter(h);
      }
    } finally {
      ClosePrinter(h);
    }
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($File)
$result = [RawPrinter]::Send($Printer, $bytes, $JobName)

switch ($result) {
  -1 { [Console]::Error.WriteLine("OpenPrinter failed for '$Printer' - is that the exact name Windows shows?"); exit 3 }
  -2 { [Console]::Error.WriteLine("StartDocPrinter failed - the spooler refused the job"); exit 4 }
  -3 { [Console]::Error.WriteLine("StartPagePrinter failed"); exit 5 }
  -4 { [Console]::Error.WriteLine("WritePrinter did not accept every byte"); exit 6 }
  default { Write-Output "sent $result bytes to $Printer"; exit 0 }
}
