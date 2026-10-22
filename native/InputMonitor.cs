using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

// Standalone state reader: no hooks, drivers, input synthesis, or game-process access.
internal static class InputMonitor
{
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int key);

    private static readonly int[] Keys = { 32, 65, 68, 83, 87, 160, 162 };
    private static readonly int[] Buttons = { 1, 2 };
    private const int PollMilliseconds = 28;

    private static void Poll(int[] codes, bool[] previous, bool mouse)
    {
        for (int i = 0; i < codes.Length; i++)
        {
            bool down = GetAsyncKeyState(codes[i]) < 0;
            if (down == previous[i]) continue;
            Console.WriteLine("{\"type\":\"" + (mouse ? "mouse" : "key") + (down ? "Down" : "Up")
                + "\",\"" + (mouse ? "button" : "vk") + "\":" + codes[i] + "}");
            previous[i] = down;
        }
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test")
        {
            Console.WriteLine("{\"keys\":[" + string.Join(",", Keys) + "],\"buttons\":[1,2],\"pollMilliseconds\":" + PollMilliseconds + "}");
            return 0;
        }
        // The parent's pipe closing ends the helper even if the app crashes.
        var parentPipe = new Thread(() => { Console.In.ReadLine(); Environment.Exit(0); });
        parentPipe.IsBackground = true;
        parentPipe.Start();
        var keys = new bool[Keys.Length];
        var buttons = new bool[Buttons.Length];
        try
        {
            while (true)
            {
                Poll(Keys, keys, false);
                Poll(Buttons, buttons, true);
                Thread.Sleep(PollMilliseconds);
            }
        }
        catch (IOException) { return 0; }
    }
}
