import { NewJob } from "@/components/home/NewJob";
import { JobList } from "@/components/home/JobList";
import { ExampleCard } from "@/components/home/ExampleCard";
import s from "./home.module.css";

export default function Home() {
  return (
    <main className="page">
      <div className={s.top}>
        <section className={s.hero}>
          <p className="label">Plan, price and propose</p>
          <h1 className="display">
            Start with the address. Leave with a signed plan.
          </h1>
          <p className="lede">
            Tierscape pulls the aerial and the property line, lets you trace the
            work to scale, prices it three ways and hands your crew the build
            pack. Mark the dig and the 811 request is ready to go.
          </p>
          <NewJob />
        </section>
        <ExampleCard />
      </div>
      <JobList />
    </main>
  );
}
