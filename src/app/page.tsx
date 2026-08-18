import NavBar from "@/components/NavBar";
import ChatApp from "@/components/ChatApp";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <>
      <NavBar />
      <ChatApp />
    </>
  );
}
